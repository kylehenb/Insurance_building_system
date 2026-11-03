import type { SupabaseClient } from '@supabase/supabase-js'
import type { McpTool, McpToolResult } from '@/lib/mcp/server'
import { loadSummary, type MetricValue } from '@/lib/health/daily'
import { getReview } from '@/lib/health/review'
import { loadAiCosts, describeAiCosts } from '@/lib/health/ai-costs'
import { alike, decideSuggestion, listSuggestions, SuggestionError, type Decision, type SuggestionRow, type SuggestionStatus } from '@/lib/health/suggestions'
import { PERIOD_KINDS, fixedLabel, type PeriodKind } from '@/lib/health/periods'

// The health check by voice and in the assistant chat (tech spec §25.6,
// §10b): the same functions as the dashboard's System & business health
// panel — loadSummary, getReview, loadAiCosts, listSuggestions and
// decideSuggestion. All need health.view (admins by default).

const db = (ctx: { supabase: unknown }) => ctx.supabase as SupabaseClient

const periodArgs = {
  period: { type: 'string', enum: PERIOD_KINDS, description: 'week (Monday to Sunday), month, quarter or year. Default week.' },
  periods_back: { type: 'integer', minimum: 0, maximum: 4, description: '0 = the current one so far (default), 1 = the last full one ("last week"), up to 4 back.' },
}

function readPeriod(args: Record<string, unknown>): { kind: PeriodKind; offset: number } | McpToolResult {
  const kind = (args.period ?? 'week') as PeriodKind
  const offset = args.periods_back == null ? 0 : Number(args.periods_back)
  if (!PERIOD_KINDS.includes(kind)) return { text: 'The period must be week, month, quarter or year.', isError: true }
  if (!Number.isInteger(offset) || offset < 0 || offset > 4) return { text: 'periods_back must be 0 to 4.', isError: true }
  return { kind, offset }
}
const isResult = (x: unknown): x is McpToolResult => !!x && typeof x === 'object' && 'text' in x

function figure(m: MetricValue | undefined): string | null {
  if (!m || m.value == null) return null
  const v = m.unit === 'aud' ? `$${Math.round(m.value).toLocaleString('en-AU')}` : m.unit === 'usd' ? `US$${m.value.toFixed(2)}` : m.value.toLocaleString('en-AU')
  const usual = m.typical != null && m.typical > 0 ? Math.round(((m.value - m.typical) / m.typical) * 100) : null
  return `${m.label} ${v}${usual == null ? '' : Math.abs(usual) < 10 ? ' (about usual)' : ` (${usual > 0 ? 'up' : 'down'} ${Math.abs(usual)}% on usual)`}`
}

const suggestionLine = (s: SuggestionRow, n: number) =>
  `${n}. ${s.title} — ${s.kind}, ${s.effort} effort${s.times_raised > 1 ? `, raised ${s.times_raised} times` : ''}${s.status !== 'open' ? `, ${s.status}` : ''}. ${s.why}`

export const getHealthCheck: McpTool = {
  name: 'get_health_check',
  title: 'Health check',
  description: [
    'How the business and the system went over a week, month, quarter or year: how busy, work done, money, insurer deadlines, AI, scheduled jobs and limits, against the period before and the usual;',
    'open alerts; and for a finished period, the written review (what worked, what didn\'t, suggested changes).',
    'Use for "how did we go this week", "how was last month", "any problems with the system".',
  ].join(' '),
  inputSchema: { type: 'object', properties: periodArgs, additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
  permission: 'health.view',
  async run(args, ctx): Promise<McpToolResult> {
    const p = readPeriod(args)
    if (isResult(p)) return p
    const summary = await loadSummary(db(ctx), ctx.tenantId, p.kind, p.offset)
    const by = Object.fromEntries(summary.metrics.map(m => [m.key, m]))
    const review = await getReview(db(ctx), ctx.tenantId, p.kind, summary.period.from)
    const suggestions = review?.id ? await listSuggestions(db(ctx), ctx.tenantId, { reviewId: review.id }) : []
    const label = p.offset === 0 ? `${summary.period.label} so far (${summary.daysCounted} day${summary.daysCounted === 1 ? '' : 's'})` : fixedLabel(summary.period)

    const lines = [`${label}.`]
    lines.push(summary.areas.map(a => `${a.label}: ${a.note}${a.light === 'red' ? ' — a problem' : a.light === 'amber' ? ' — worth a look' : ''}.`).join(' '))
    const work = ['orders_received', 'jobs_created', 'emails_in', 'inspections_done', 'jobs_completed', 'invoiced_aud', 'paid_aud', 'owed_aud'].map(k => figure(by[k])).filter(Boolean)
    if (work.length) lines.push(`${work.join('; ')}.`)
    const met = by.kpi_met?.value ?? 0
    const missed = by.kpi_missed?.value ?? 0
    if (met + missed) lines.push(`Insurer deadlines: ${met} met, ${missed} missed.`)
    if (summary.alerts.length) lines.push(`Open alerts: ${summary.alerts.map(a => a.title).join('; ')}.`)
    if (p.offset === 0) lines.push(`The written review comes the night after the ${p.kind} ends.`)
    else if (!review) lines.push('The written review isn\'t ready yet.')
    else if (review.status === 'failed') lines.push(`The written review couldn't be written: ${review.error}.`)
    else {
      lines.push(`Review: ${review.headline}`)
      for (const s of review.sections) if (s.points.length) lines.push(`${s.title}: ${s.points.slice(0, 3).map(pt => pt.text).join(' ')}`)
      if (suggestions.length) lines.push(`Suggested changes:\n${suggestions.map((s, i) => suggestionLine(s, i + 1)).join('\n')}`)
    }
    return {
      text: lines.join('\n'),
      data: {
        period: summary.period,
        areas: summary.areas,
        alerts: summary.alerts,
        metrics: summary.metrics.filter(m => m.value != null),
        review: review && { status: review.status, headline: review.headline, sections: review.sections },
        suggestions: suggestions.map(s => ({ suggestion_id: s.id, title: s.title, status: s.status, kind: s.kind, effort: s.effort })),
      },
    }
  },
}

export const getAiCosts: McpTool = {
  name: 'get_ai_costs',
  title: 'AI costs',
  description: [
    'What the AI cost over a week, month, quarter or year, broken down by feature (action cards, reading orders, reports…) with each one\'s share, cost per request and change on the same days before.',
    'Use for "what\'s the AI costing", "why is AI spend up", "which feature costs the most".',
  ].join(' '),
  inputSchema: { type: 'object', properties: periodArgs, additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
  permission: 'health.view',
  async run(args, ctx): Promise<McpToolResult> {
    const p = readPeriod(args)
    if (isResult(p)) return p
    const costs = await loadAiCosts(db(ctx), ctx.tenantId, p.kind, p.offset)
    return { text: describeAiCosts(costs), data: { ...costs } }
  },
}

const STATUSES: (SuggestionStatus | 'all')[] = ['open', 'accepted', 'done', 'dismissed', 'all']

export const listHealthSuggestions: McpTool = {
  name: 'list_health_suggestions',
  title: 'Health check suggestions',
  description: [
    'The changes the health reviews have suggested (automations, wording, process and system changes), newest first, with why each was suggested.',
    'Defaults to open and accepted ones; status narrows it. Each has a suggestion_id for decide_health_suggestion.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { status: { type: 'string', enum: STATUSES, description: 'open, accepted, done, dismissed, or all. Default: open and accepted.' } },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  permission: 'health.view',
  async run(args, ctx): Promise<McpToolResult> {
    const status = args.status as SuggestionStatus | 'all' | undefined
    if (status && !STATUSES.includes(status)) return { text: `status must be one of: ${STATUSES.join(', ')}.`, isError: true }
    const statuses: SuggestionStatus[] | undefined = status === 'all' ? undefined : status ? [status] : ['open', 'accepted']
    const rows = await listSuggestions(db(ctx), ctx.tenantId, { statuses, limit: 20 })
    if (!rows.length) return { text: status === 'all' ? 'The health reviews haven\'t suggested anything yet.' : `No ${status ?? 'open or accepted'} suggestions.`, data: { suggestions: [] } }
    return {
      text: rows.map((s, i) => suggestionLine(s, i + 1)).join('\n'),
      data: { suggestions: rows.map(s => ({ suggestion_id: s.id, title: s.title, why: s.why, kind: s.kind, effort: s.effort, status: s.status, times_raised: s.times_raised, note: s.note, created_at: s.created_at })) },
    }
  },
}

const DECISIONS: Decision[] = ['accepted', 'dismissed', 'done', 'open']
const DONE_WORDS: Record<Decision, string> = { accepted: 'Accepted', dismissed: 'Dismissed', done: 'Marked done', open: 'Reopened' }

export const decideHealthSuggestion: McpTool = {
  name: 'decide_health_suggestion',
  title: 'Decide a health check suggestion',
  description: [
    'Accepts, dismisses, marks done or reopens a change the health review suggested. Give suggestion_id (from list_health_suggestions or get_health_check), or the suggestion\'s title in your own words.',
    'decision: "accepted" (we\'ll do it), "dismissed" (not doing it; ask why and pass it as note — later reviews learn from it), "done" (it\'s in place; note how, if they say), "open" (undo a decision).',
    'Read back the suggestion and the decision and get a clear yes before calling.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      suggestion_id: { type: 'string', description: 'The suggestion\'s id.' },
      title: { type: 'string', description: 'Or the suggestion as the person described it, e.g. "the one about Castle deadlines".' },
      decision: { type: 'string', enum: DECISIONS },
      note: { type: 'string', description: 'Why it was dismissed, or how it was done.' },
    },
    required: ['decision'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  permission: 'health.view',
  async run(args, ctx): Promise<McpToolResult> {
    const decision = args.decision as Decision
    if (!DECISIONS.includes(decision)) return { text: `decision must be one of: ${DECISIONS.join(', ')}.`, isError: true }
    let id = typeof args.suggestion_id === 'string' ? args.suggestion_id.trim() : ''
    if (!id) {
      const said = typeof args.title === 'string' ? args.title.trim() : ''
      if (!said) return { text: 'Which suggestion? Give its suggestion_id or describe it.', isError: true }
      const rows = await listSuggestions(db(ctx), ctx.tenantId, { limit: 100 })
      const ranked = rows.map(s => ({ s, score: Math.max(alike(s.title, said), alike(`${s.title} ${s.why}`, said)) })).filter(x => x.score >= 0.15).sort((a, b) => b.score - a.score)
      if (!ranked.length) return { text: `No suggestion matches "${said}". Use list_health_suggestions to see them.`, isError: true }
      if (ranked.length > 1 && ranked[1].score >= ranked[0].score * 0.8) {
        return { text: `That could be more than one — which did you mean?\n${ranked.slice(0, 3).map((x, i) => suggestionLine(x.s, i + 1)).join('\n')}`, isError: true, data: { candidates: ranked.slice(0, 3).map(x => ({ suggestion_id: x.s.id, title: x.s.title })) } }
      }
      id = ranked[0].s.id
    }
    try {
      const s = await decideSuggestion(db(ctx), ctx.tenantId, id, decision, { userId: ctx.userId, note: typeof args.note === 'string' ? args.note : null })
      return { text: `${DONE_WORDS[decision]}: "${s.title}".${decision === 'dismissed' && !s.note ? ' (No reason given — later reviews learn more when there is one.)' : ''}`, data: { suggestion_id: s.id, status: s.status } }
    } catch (err) {
      if (err instanceof SuggestionError) return { text: err.message, isError: true }
      throw err
    }
  },
}

export const HEALTH_TOOLS = [getHealthCheck, getAiCosts, listHealthSuggestions, decideHealthSuggestion]
