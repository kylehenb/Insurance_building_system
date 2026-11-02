import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { McpContext } from '@/lib/mcp/server'
import { getJobSummary } from '@/lib/mcp/tools/jobs'
import { cardActor, CARD_COLUMNS, type ActionCard } from '@/lib/actions/cards'
import { createFollowUp, followUpDay, spokenDue } from '@/lib/actions/followups'
import { pinnedTo } from '@/lib/actions/waits'
import { pruneOldEvents } from '@/lib/calendar/sync'

// The daily job review (tech spec §23.14): IRC's own initiative. Each morning
// it reads the open jobs that changed since it last read them — and, once a
// week, the ones that have gone quiet — notes where each stands
// (jobs.review_note) and plans dated checks as follow-ups (kind 'watch'):
// "the painter was going Saturday — did he go? Then the job can be closed and
// invoiced", "the windows are a week out after months of waiting — still on
// track?". On the day, the check comes onto the action cards, where the card
// AI first sees whether it's still needed. Nothing is sent by itself.
//
// Guardrails, so cost grows with what changes, not with how many jobs there
// are: a job is only read again once something on it has changed (or a week
// has passed); a company has a cap of jobs read per day; a job gets at most
// two new checks a review and none while three of IRC's are already open; a
// check never repeats one already waiting.

export const REVIEW_MODEL = process.env.AI_REVIEW_MODEL || 'claude-haiku-5-5'

/** Jobs read per company per day, unless automation_config 'job_review_daily_limit' says otherwise */
const DEFAULT_DAILY_LIMIT = 40
/** A job made, written about or with something coming up this recently counts as open (until job stages are fixed) */
const OPEN_DAYS = 60
/** An unchanged open job is read again after this long: the weekly look at jobs gone quiet */
const QUIET_DAYS = 7
const MAX_NEW_CHECKS = 2
const MAX_OPEN_CHECKS = 3
/** Done sent-email reads are let go after this long */
const KEEP_SENT_DAYS = 60

const DAY_MS = 86_400_000
const now = () => new Date().toISOString()
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

type JobRow = { id: string; job_number: string; created_at: string | null; reviewed_at: string | null }

/** The jobs worth looking at: made or written about lately, or with something open or coming up */
export async function openJobs(db: SupabaseClient, tenantId: string, at = new Date()): Promise<Map<string, { lastActivity: string | null }>> {
  const since = new Date(at.getTime() - OPEN_DAYS * DAY_MS).toISOString()
  const ahead = new Date(at.getTime() + 30 * DAY_MS).toISOString()
  const [{ data: made }, { data: comms }, { data: cards }, { data: events }] = await Promise.all([
    db.from('jobs').select('id, created_at').eq('tenant_id', tenantId).gte('created_at', since),
    db.from('communications').select('job_id, created_at').eq('tenant_id', tenantId).gte('created_at', since).not('job_id', 'is', null),
    db.from('action_queue').select('job_id, updated_at, status').eq('tenant_id', tenantId).not('job_id', 'is', null)
      .in('status', ['scheduled', 'queued', 'pending', 'failed', 'done', 'skipped', 'no_action']).gte('updated_at', since),
    db.from('calendar_events').select('job_id, updated_at').eq('tenant_id', tenantId).not('job_id', 'is', null).gte('start_at', since).lte('start_at', ahead),
  ])
  const out = new Map<string, { lastActivity: string | null }>()
  const touch = (id: string | null, at: string | null) => {
    if (!id) return
    const was = out.get(id)?.lastActivity ?? null
    out.set(id, { lastActivity: at && (!was || at > was) ? at : was })
  }
  for (const j of (made as { id: string; created_at: string }[] | null) ?? []) touch(j.id, j.created_at)
  for (const c of (comms as { job_id: string; created_at: string }[] | null) ?? []) touch(c.job_id, c.created_at)
  for (const c of (cards as { job_id: string; updated_at: string }[] | null) ?? []) touch(c.job_id, c.updated_at)
  for (const e of (events as { job_id: string; updated_at: string }[] | null) ?? []) touch(e.job_id, e.updated_at)
  return out
}

/** The open jobs to read today: changed since last read, or not read for a week; least recently read first, up to the limit */
export async function jobsToReview(db: SupabaseClient, tenantId: string, limit: number, at = new Date()): Promise<JobRow[]> {
  const open = await openJobs(db, tenantId, at)
  if (!open.size) return []
  const { data } = await db.from('jobs').select('id, job_number, created_at, reviewed_at').eq('tenant_id', tenantId).in('id', [...open.keys()])
  const quiet = new Date(at.getTime() - QUIET_DAYS * DAY_MS).toISOString()
  return ((data as JobRow[] | null) ?? [])
    .filter(j => {
      if (!j.reviewed_at) return true
      const last = open.get(j.id)?.lastActivity
      return (!!last && last > j.reviewed_at) || j.reviewed_at < quiet
    })
    .sort((a, b) => (a.reviewed_at ?? '') < (b.reviewed_at ?? '') ? -1 : 1)
    .slice(0, limit)
}

const REVIEW_TOOL: Anthropic.Beta.BetaTool = {
  name: 'review_job',
  description: 'Record where the job stands and the checks to plan. Call it once.',
  input_schema: {
    type: 'object',
    properties: {
      state: { type: 'string', description: 'One line: where the job stands and what it\'s waiting on, e.g. "Waiting on Castle\'s decision on the $12,026 quote, sent 1 Nov".' },
      checks: {
        type: 'array',
        maxItems: MAX_NEW_CHECKS,
        description: 'Checks to plan (usually none). Each comes onto the action cards on its day.',
        items: {
          type: 'object',
          properties: {
            when: { type: 'string', description: 'A Perth date "2026-11-09" (it comes up at 8am), or "now" if it needs doing today.' },
            what: { type: 'string', description: 'The check, as the office would put it: "Did the painter go on Saturday? If so, close the job and invoice."' },
            who: { type: 'string', description: 'Who it\'s about, if anyone: "Great Lengths Painting".' },
            why: { type: 'string', description: 'Why then, in a line.' },
          },
          required: ['when', 'what', 'why'],
        },
      },
      cancel: { type: 'array', items: { type: 'string' }, description: 'IRC\'s own checks (kind check) listed below that are no longer needed, by id.' },
    },
    required: ['state', 'checks'],
  },
}

export const REVIEW_PROMPT = `You look over one open job of Insurance Repair Co (building insurance repairs in Perth) each morning, to use initiative the way a sharp office manager would: keep the job moving to completion and payment, and catch things before they slip. Call review_job once.

- state: one line on where the job stands and what it's waiting on.
- checks: dated checks for IRC to raise on their day — usually none. Plan one only when there's a real reason:
  - Something was due to happen and nothing shows it did: a trade attending ("the painter was going Saturday" → check the next working day: did they go? then close and invoice), a quote, report or booking someone promised, an insurer decision past its usual time.
  - Something important is coming up that needs confirming: an install or booking (especially one that took long to arrange or has had problems — check about a week before that it's still on track), an appointment.
  - A KPI (in the job file) is close or overdue with nothing under way, or the job has stalled with nothing pending and no one waiting: when "now".
- Don't double up: the job's open follow-ups, waits and cards are listed. If one already covers it, plan nothing. At most ${MAX_NEW_CHECKS}.
- cancel: IRC's own checks listed that are no longer needed (it happened, or the job moved on).
- A job that is simply waiting on someone with a follow-up already set needs nothing. Planning nothing is the usual right answer — the office should only hear from you when it matters.

Today is given in the first message. Times are Perth time (AWST).`

const today = (at: Date) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(at)

export type ReviewResult = { job: string; state: string; checks: string[]; cancelled: number; error?: string }

/** Reads one job and plans its checks. Never throws — a failure leaves the job to be read next time */
export async function reviewJob(db: SupabaseClient, tenantId: string, job: JobRow, opts: { client?: Pick<Anthropic, 'beta'>; at?: Date } = {}): Promise<ReviewResult> {
  const at = opts.at ?? new Date()
  try {
    const ctx: McpContext = { supabase: db as unknown as SupabaseClient<Database>, tenantId, userId: await cardActor(db, tenantId), via: 'chat' }
    const jobFile = (await getJobSummary.run({ job_number: job.job_number }, ctx)).text
    const { data } = await db.from('action_queue').select(CARD_COLUMNS)
      .eq('tenant_id', tenantId).eq('job_id', job.id).in('status', ['scheduled', 'queued', 'generating', 'pending', 'failed'])
    const open = (data as ActionCard[] | null) ?? []
    const openLines = open.map(c => {
      const kind = c.source === 'followup' ? (c.follow_up?.kind === 'watch' ? 'check' : c.follow_up?.kind === 'waiting_on' ? 'wait' : 'follow-up') : 'card'
      return `- ${kind} ${c.id}: ${c.title}${c.status === 'scheduled' && c.due_at ? ` (due ${spokenDue(c.due_at)})` : ` (${c.status === 'scheduled' ? 'scheduled' : 'on the action cards now'})`}`
    })

    const client = opts.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await client.beta.messages.create({
      model: REVIEW_MODEL,
      max_tokens: 2000,
      system: [{ type: 'text', text: REVIEW_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [REVIEW_TOOL],
      tool_choice: { type: 'tool', name: REVIEW_TOOL.name },
      messages: [{ role: 'user', content: `Today: ${today(at)}.\n\nTHE JOB FILE\n${jobFile}\n\nOPEN FOLLOW-UPS, WAITS, CHECKS AND CARDS ON THIS JOB\n${openLines.join('\n') || '(none)'}` }],
    } as Anthropic.Beta.MessageCreateParamsNonStreaming)
    const call = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === REVIEW_TOOL.name)
    if (!call) throw new Error('The AI didn\'t review the job')
    const out = (call.input ?? {}) as { state?: unknown; checks?: unknown; cancel?: unknown }

    // IRC's own checks it no longer needs
    const mine = open.filter(c => c.follow_up?.kind === 'watch' && c.status === 'scheduled')
    const cancelIds = (Array.isArray(out.cancel) ? out.cancel : []).filter((id): id is string => typeof id === 'string' && mine.some(c => c.id === id))
    for (const id of cancelIds) {
      await db.from('action_queue').update({ status: 'skipped', outcome: 'No longer needed (job review)', updated_at: now() }).eq('id', id).eq('status', 'scheduled')
    }

    // New checks, within the caps
    const stillOpen = mine.length - cancelIds.length
    const room = Math.max(0, Math.min(MAX_NEW_CHECKS, MAX_OPEN_CHECKS - stillOpen))
    const planned: string[] = []
    if (room) {
      const owner = await pinnedTo(db, tenantId, null, job.id)
      for (const c of (Array.isArray(out.checks) ? out.checks : []).slice(0, room) as Record<string, unknown>[]) {
        const what = str(c.what)
        if (!what) continue
        const when = str(c.when).toLowerCase()
        const soon = new Date(at.getTime() + 2 * 60_000).toISOString()
        const day = /^\d{4}-\d{2}-\d{2}$/.test(when) ? followUpDay(when) : null
        const due = day && day > soon ? day : soon
        try {
          await createFollowUp(db, tenantId, owner.userId, { jobId: job.id, note: what, who: str(c.who) || null, dueAt: due, watch: { why: str(c.why).slice(0, 300) } })
          planned.push(`${spokenDue(due)}: ${what}`)
        } catch (err) {
          console.error(`[job-review] check on ${job.job_number} not set:`, err)
        }
      }
    }

    const state = str(out.state).slice(0, 500)
    await db.from('jobs').update({ reviewed_at: at.toISOString(), review_note: state || null }).eq('id', job.id)
    return { job: job.job_number, state, checks: planned, cancelled: cancelIds.length }
  } catch (err) {
    console.error(`[job-review] ${job.job_number} failed:`, err)
    return { job: job.job_number, state: '', checks: [], cancelled: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

/** A company's daily limit of jobs read (automation_config 'job_review_daily_limit') */
async function dailyLimit(db: SupabaseClient, tenantId: string): Promise<number> {
  const { data } = await db.from('automation_config').select('value').eq('tenant_id', tenantId).eq('key', 'job_review_daily_limit').maybeSingle()
  const n = Number((data as { value: string } | null)?.value)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : DEFAULT_DAILY_LIMIT
}

/** Records nothing reads any more: old calendar events and finished sent-email reads */
export async function cleanUp(db: SupabaseClient, at = new Date()): Promise<void> {
  await pruneOldEvents(db, at)
  await db.from('sent_emails').delete().in('status', ['done', 'failed']).lt('updated_at', new Date(at.getTime() - KEEP_SENT_DAYS * DAY_MS).toISOString())
}

/** Every company's review for today (the morning cron), then the clean-up */
export async function reviewAllJobs(db: SupabaseClient, opts: { client?: Pick<Anthropic, 'beta'>; at?: Date; budgetMs?: number } = {}): Promise<ReviewResult[]> {
  const at = opts.at ?? new Date()
  const started = Date.now()
  const results: ReviewResult[] = []
  if (opts.client || process.env.ANTHROPIC_API_KEY) {
    const { data } = await db.from('tenants').select('id')
    for (const t of (data as { id: string }[] | null) ?? []) {
      for (const job of await jobsToReview(db, t.id, await dailyLimit(db, t.id), at)) {
        if (opts.budgetMs && Date.now() - started > opts.budgetMs) break
        results.push(await reviewJob(db, t.id, job, { client: opts.client, at }))
      }
    }
  }
  await cleanUp(db, at).catch(err => console.error('[job-review] clean-up failed:', err))
  return results
}
