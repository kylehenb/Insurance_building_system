import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, dayStartIso, daysBetween, fixedLabel, perthDay, periodFor, type Period, type PeriodKind } from './periods'

// Where the AI money goes (tech spec §25.6): one period's AI spend broken
// down by feature (and by model), against the same days of the period
// before, read straight from ai_calls. For the health panel's "Where the AI
// money goes" section and the get_ai_costs voice tool.

/** What each AI feature is, for people deciding whether it's worth what it costs */
export const AI_FEATURES: Record<string, { label: string; what: string }> = {
  'action-cards': { label: 'Action cards', what: 'reads each incoming email with its job file and proposes the next steps' },
  'order-parser': { label: 'Reading insurer orders', what: 'reads each order email and attachment into the order form' },
  'email-job-match': { label: 'Matching emails to jobs', what: 'pulls claim and job numbers out of emails that don\'t match a job' },
  'email-summary': { label: 'Email summaries', what: 'summarises a job\'s emails when asked' },
  'attachment-read': { label: 'Reading attachments', what: 'reads PDFs and images attached to emails' },
  'waiting-on': { label: 'Waiting on', what: 'reads each sent email for what it asks and when to chase' },
  'job-review': { label: 'Morning job review', what: 'reads each changed open job every morning and plans dated checks' },
  'calendar-link': { label: 'Calendar matching', what: 'matches calendar events to jobs' },
  'assistant': { label: 'Assistant chat and voice', what: 'the in-app assistant and the voice connector\'s conversations' },
  'report': { label: 'Report writing', what: 'drafts inspection reports' },
  'report-generate': { label: 'Report drafts', what: 'drafts a report from inspection notes' },
  'report-embeddings': { label: 'Report search index', what: 'indexes past reports so alike ones can be found (very cheap)' },
  'photo-labels': { label: 'Photo labels', what: 'labels and orders inspection photos' },
  'roof-photo-labels': { label: 'Roof photo labels', what: 'labels roof photos in the field app' },
  'field-scope-notes': { label: 'Field scope notes', what: 'turns the inspector\'s scope notes into quote lines' },
  'field-bar-report': { label: 'Field report (BAR)', what: 'writes the building assessment report on field submit' },
  'field-property-details': { label: 'Field property details', what: 'pulls property details from the field notes' },
  'field-roof-report': { label: 'Field roof report', what: 'writes the roof report on field submit' },
  'field-ai-review': { label: 'Field AI review', what: 'checks a field inspection before it\'s submitted' },
  'learning-review': { label: 'Nightly learning review', what: 'turns the office\'s decisions into lessons (a stronger model, once a night)' },
  'health-review': { label: 'Health reviews', what: 'writes the weekly, monthly, quarterly and yearly health reviews' },
}

export function featureInfo(feature: string): { label: string; what: string; midcity: boolean } {
  const midcity = feature.startsWith('midcity-')
  const base = AI_FEATURES[feature] ?? AI_FEATURES[feature.replace(/^midcity-/, '')]
  const label = base?.label ?? feature.replace(/^midcity-/, '').replace(/-/g, ' ').replace(/^./, c => c.toUpperCase())
  return { label: midcity ? `Midcity: ${label}` : label, what: midcity ? `${base?.what ?? 'AI work'} — for Midcity, a separate business` : base?.what ?? 'AI work', midcity }
}

export interface CostLine {
  key: string
  label: string
  what?: string
  midcity?: boolean
  calls: number
  failed: number
  costUsd: number
  /** Share of the period's spend, 0–1 */
  share: number
  costPerCall: number | null
  /** Same days of the period before */
  previousCostUsd: number
  /** Calls whose model has no price set (their cost is missing) */
  unpriced: number
}

export interface AiCosts {
  period: Pick<Period, 'kind' | 'offset' | 'from' | 'to' | 'label'>
  daysCounted: number
  totalUsd: number
  previousTotalUsd: number
  perDayUsd: number
  calls: number
  failed: number
  features: CostLine[]
  models: CostLine[]
  /** Before AI calls were recorded (3 Nov 2026) there's nothing to show */
  trackedSince: string | null
}

type Call = { feature: string; model: string; ok: boolean; cost_usd: number | string | null }

async function callsBetween(db: SupabaseClient, tenantId: string, from: string, to: string): Promise<Call[]> {
  const out: Call[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from('ai_calls').select('feature, model, ok, cost_usd')
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .gte('created_at', dayStartIso(from)).lt('created_at', dayStartIso(to))
      .order('created_at', { ascending: true }).range(offset, offset + 999)
    if (error) throw new Error(`ai_calls: ${error.message}`)
    out.push(...((data ?? []) as Call[]))
    if ((data ?? []).length < 1000) return out
  }
}

const round = (n: number) => Math.round(n * 10000) / 10000

function group(calls: Call[], before: Call[], keyOf: (c: Call) => string, total: number): CostLine[] {
  const lines = new Map<string, CostLine>()
  const line = (key: string) => {
    let l = lines.get(key)
    if (!l) { l = { key, label: key, calls: 0, failed: 0, costUsd: 0, share: 0, costPerCall: null, previousCostUsd: 0, unpriced: 0 }; lines.set(key, l) }
    return l
  }
  for (const c of calls) {
    const l = line(keyOf(c))
    l.calls++
    if (!c.ok) l.failed++
    if (c.cost_usd == null) { if (c.ok) l.unpriced++ } else l.costUsd += Number(c.cost_usd) || 0
  }
  for (const c of before) line(keyOf(c)).previousCostUsd += Number(c.cost_usd) || 0
  return [...lines.values()].map(l => ({
    ...l,
    costUsd: round(l.costUsd),
    previousCostUsd: round(l.previousCostUsd),
    share: total ? l.costUsd / total : 0,
    // Per successful, priced request (a failed one costs nothing)
    costPerCall: l.calls - l.failed - l.unpriced > 0 ? round(l.costUsd / (l.calls - l.failed - l.unpriced)) : null,
  })).sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls)
}

export async function loadAiCosts(db: SupabaseClient, tenantId: string, kind: PeriodKind, offset: number, now: Date = new Date()): Promise<AiCosts> {
  const today = perthDay(now)
  const p = periodFor(kind, offset, now)
  const before = periodFor(kind, offset + 1, now)
  // The current period runs to today; the one before is cut to the same number of days
  const end = p.to > today ? addDays(today, 1) : p.to
  const days = daysBetween(p.from, end).length
  const beforeEnd = p.to > today ? addDays(before.from, days) : before.to
  const [calls, prior] = await Promise.all([callsBetween(db, tenantId, p.from, end), callsBetween(db, tenantId, before.from, beforeEnd)])

  const total = calls.reduce((s, c) => s + (Number(c.cost_usd) || 0), 0)
  const features = group(calls, prior, c => c.feature, total).map(l => {
    const info = featureInfo(l.key)
    return { ...l, label: info.label, what: info.what, midcity: info.midcity }
  })
  const models = group(calls, prior, c => c.model, total).map(l => ({ ...l, label: l.key }))
  const { data: first } = await db.from('ai_calls').select('created_at').order('created_at', { ascending: true }).limit(1)
  const firstAt = (first as { created_at: string }[] | null)?.[0]?.created_at

  return {
    period: { kind, offset, from: p.from, to: p.to, label: offset === 0 ? p.label : fixedLabel(p) },
    daysCounted: days,
    totalUsd: round(total),
    previousTotalUsd: round(prior.reduce((s, c) => s + (Number(c.cost_usd) || 0), 0)),
    perDayUsd: days ? round(total / days) : 0,
    calls: calls.length,
    failed: calls.filter(c => !c.ok).length,
    features,
    models,
    trackedSince: firstAt ? perthDay(firstAt) : null,
  }
}

const usd = (n: number) => (n < 0.01 && n > 0 ? 'under 1 cent' : `US$${n.toFixed(2)}`)

/** The breakdown in a few spoken-friendly sentences (voice and chat). */
export function describeAiCosts(c: AiCosts, top = 6): string {
  if (!c.calls) return c.trackedSince ? `No AI requests were recorded for ${c.period.label.toLowerCase()}.` : 'AI costs have only just started being recorded, so there\'s nothing to show yet.'
  const change = c.previousTotalUsd ? Math.round(((c.totalUsd - c.previousTotalUsd) / c.previousTotalUsd) * 100) : null
  const lines = [
    `${c.period.label}: ${usd(c.totalUsd)} on ${c.calls.toLocaleString('en-AU')} AI requests over ${c.daysCounted} day${c.daysCounted === 1 ? '' : 's'}, about ${usd(c.perDayUsd)} a day${change == null ? '' : `, ${change === 0 ? 'the same as' : `${Math.abs(change)}% ${change > 0 ? 'more than' : 'less than'}`} the same days before`}.${c.failed ? ` ${c.failed} failed.` : ''}`,
    'Biggest costs:',
    ...c.features.slice(0, top).map(f => `- ${f.label}: ${usd(f.costUsd)} (${Math.round(f.share * 100)}%), ${f.calls} requests${f.costPerCall != null ? `, ${usd(f.costPerCall)} each` : ''} — ${f.what}.${f.unpriced ? ` ${f.unpriced} requests have no price set.` : ''}`),
  ]
  if (c.features.length > top) lines.push(`…and ${c.features.length - top} smaller ones.`)
  return lines.join('\n')
}
