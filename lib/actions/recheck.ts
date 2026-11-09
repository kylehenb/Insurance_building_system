import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { McpContext } from '@/lib/mcp/server'
import { getJobSummary } from '@/lib/mcp/tools/jobs'
import { isFieldAppJob } from '@/lib/jobs/field-app'
import { trackAi } from '@/lib/health/ai-usage'
import { logError } from '@/lib/health/errors'
import { activeLessons, formatLessons } from '@/lib/learning/lessons'
import { formatCases, recordLearning, similarCases } from '@/lib/learning/events'
import { mailDb } from '@/lib/mail/sync'
import { CARD_COLUMNS, cardActor, cardThreadId, type ActionCard } from './cards'
import { CARD_LIKENESS, situationText } from './learning'

// Out-of-date action cards (tech spec §23.17). A card is written from the job
// as it stood then; when the work gets done another way (documents sent from
// the job page, a note after a phone call, a trade's email on another
// conversation) the card would otherwise sit there asking for it again.
//
// 1. Something lands in a job's Comms feed → the database marks the job
//    (job_card_rechecks, migration 20261128_card_rechecks.sql), whichever way
//    it was saved. Free.
// 2. The minute cron waits until the job has gone quiet (no change for
//    QUIET_MS) and nobody has it open (job_presence, the job page's
//    heartbeat) — or MAX_WAIT_MS has passed — so an afternoon on a job is one
//    check, not one per change.
// 3. Rules (judgeChange, free) decide whether a change could have done or
//    changed what a card asks. Only then does the AI read the job's open
//    cards with what happened since, once per job: still needed (left as it
//    is), done (moved to Done — "Looks done: …", put back with one click,
//    and that's learned from), the same as another card (closed), or needs
//    new steps (the card is made again from the job as it is now).
// 4. Any other change only shows on the card ("Since this was written: …",
//    cardChanges) and is asked about before its steps run (confirm.ts).

export const RECHECK_MODEL = process.env.AI_CARD_MODEL || 'claude-haiku-5-5'
/** The learning module's name for it (tech spec §24) */
export const FEATURE = 'card_recheck'
/** Its AI calls, for the health check (lib/health/ai-costs.ts) */
export const AI_FEATURE = 'card-recheck'

/** No change on the job for this long: it's gone quiet */
export const QUIET_MS = 10 * 60_000
/** The job page says it's open every minute; seen within this, someone's on it */
export const PRESENT_MS = 3 * 60_000
/** Checked by then whatever, so a job left open all day still gets looked at */
export const MAX_WAIT_MS = 3 * 3_600_000
/** AI checks a company gets a day — a busy day can't run up the bill */
export const DAILY_CAP = 80

/** How a card closed by a check starts its outcome: it can be put back, and that's learned from */
export const LOOKS_DONE = 'Looks done: '
export const SAME_AS = 'Same as another card: '

export type JobChange = {
  id: string
  at: string
  /** activity: an action from the who-did-what log; the rest are feed rows */
  kind: 'activity' | 'note' | 'email_in' | 'email_out' | 'portal' | 'other'
  /** The permission key or system event, for activity */
  action: string | null
  summary: string
  thread_id: string | null
  who: string | null
}

export type ChangeWeight = 'review' | 'flag' | 'ignore'

/** Actions whose record is a feed row already, or the cards' own doing */
const IGNORED_ACTIONS = new Set(['actions.review', 'mail.send', 'send.replies', 'jobs.notes', 'approval.decide'])

/** Things done on a job that often are what a card was asking for */
const REVIEW_ACTIONS = new Set([
  'send.documents', 'send.work_orders', 'send.signing', 'invoices.manage', 'excess.decide',
  'jobs.change_stage', 'orders.lodge', 'job.phase', 'invoice.paid',
])

/**
 * Whether a change on the job could have done or changed what this card
 * asks: review (the AI looks), flag (shown on the card, asked about before
 * confirming) or ignore.
 */
export function judgeChange(card: Pick<ActionCard, 'source' | 'source_ref' | 'follow_up'>, change: JobChange): ChangeWeight {
  if (change.kind === 'activity') {
    if (!change.action || IGNORED_ACTIONS.has(change.action)) return 'ignore'
    return REVIEW_ACTIONS.has(change.action) ? 'review' : 'flag'
  }
  // A note is often the phone call that dealt with it: only the AI can read that
  if (change.kind === 'note') return 'review'
  if (change.kind === 'email_in' || change.kind === 'email_out') {
    // The card's own conversation re-reads or closes the card by itself (cards.ts onMailArrivals)
    if (card.source === 'email' && change.thread_id && change.thread_id === cardThreadId(card)) return 'ignore'
    return 'review'
  }
  if (change.kind === 'portal') return 'review'
  return 'flag'
}

/** What happened on the job after the card last saw it, and what it weighs for this card */
export function changesFor(card: Pick<ActionCard, 'source' | 'source_ref' | 'follow_up' | 'checked_at' | 'updated_at'>, changes: JobChange[]): { review: JobChange[]; flag: JobChange[] } {
  const since = card.checked_at ?? card.updated_at
  const out = { review: [] as JobChange[], flag: [] as JobChange[] }
  for (const c of changes) {
    if (c.at <= since) continue
    const w = judgeChange(card, c)
    if (w !== 'ignore') out[w].push(c)
  }
  return out
}

/** Whether a marked job is ready to be checked: quiet, and nobody has it open (or it's waited long enough) */
export function readyToCheck(row: { first_change_at: string; last_change_at: string }, lastSeen: string | null, at = new Date()): boolean {
  const now = at.getTime()
  if (now - Date.parse(row.first_change_at) >= MAX_WAIT_MS) return true
  if (now - Date.parse(row.last_change_at) < QUIET_MS) return false
  return !lastSeen || now - Date.parse(lastSeen) >= PRESENT_MS
}

const perth = (iso: string) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

/** One line for a change: "Mon 6 Nov, 2:14 pm — Kyle: Sent the BAR to Castle" */
export function changeLine(c: JobChange): string {
  const what = c.kind === 'note' ? `Job note: ${c.summary}`
    : c.kind === 'email_in' ? `Email in: ${c.summary}`
    : c.kind === 'email_out' ? `Email sent: ${c.summary}`
    : c.kind === 'portal' ? `Insurer portal: ${c.summary}`
    : c.summary
  return `${perth(c.at)}${c.who ? ` — ${c.who}` : ''}: ${what}`
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

type ActivityRow = { id: string; created_at: string; job_id: string; user_id: string | null; action: string; summary: string; via: string }
type CommRow = { id: string; created_at: string; job_id: string; type: string; direction: string | null; subject: string | null; content: string | null; body_text: string | null; contact_name: string | null; thread_id: string | null; created_by: string | null }

/** What landed in these jobs' feeds after `since`, oldest first, by job */
export async function jobChanges(db: SupabaseClient, tenantId: string, jobIds: string[], since: string): Promise<Map<string, JobChange[]>> {
  const out = new Map<string, JobChange[]>()
  if (!jobIds.length) return out
  const [{ data: acts }, { data: comms }] = await Promise.all([
    db.from('activity_log').select('id, created_at, job_id, user_id, action, summary, via')
      .eq('tenant_id', tenantId).in('job_id', jobIds).gt('created_at', since).eq('outcome', 'done')
      .order('created_at', { ascending: true }).limit(500),
    db.from('communications').select('id, created_at, job_id, type, direction, subject, content, body_text, contact_name, thread_id, created_by')
      .eq('tenant_id', tenantId).in('job_id', jobIds).gt('created_at', since)
      .order('created_at', { ascending: true }).limit(500),
  ])
  const activity = ((acts as ActivityRow[] | null) ?? []).filter(a => !IGNORED_ACTIONS.has(a.action))
  const feed = (comms as CommRow[] | null) ?? []
  const userIds = [...new Set([...activity.map(a => a.user_id), ...feed.map(c => c.created_by)].filter((id): id is string => !!id))]
  const { data: users } = userIds.length ? await db.from('users').select('id, name').eq('tenant_id', tenantId).in('id', userIds) : { data: [] }
  const names = new Map(((users as { id: string; name: string | null }[] | null) ?? []).map(u => [u.id, u.name]))
  const add = (jobId: string, c: JobChange) => { const list = out.get(jobId) ?? []; list.push(c); out.set(jobId, list) }
  for (const a of activity) {
    add(a.job_id, {
      id: `a:${a.id}`, at: a.created_at, kind: 'activity', action: a.action, summary: clip(a.summary, 200), thread_id: null,
      who: a.via === 'system' ? 'IRC (automatic)' : a.user_id ? names.get(a.user_id) ?? null : null,
    })
  }
  for (const c of feed) {
    const kind: JobChange['kind'] = c.type === 'note' ? 'note'
      : c.type === 'email' ? (c.direction === 'outbound' ? 'email_out' : 'email_in')
      : c.type === 'portal' ? 'portal' : 'other'
    const text = c.type === 'note' ? (c.content || c.body_text || '') : (c.subject || c.content || '')
    add(c.job_id, {
      id: `c:${c.id}`, at: c.created_at, kind, action: null, thread_id: c.thread_id,
      summary: clip(`${kind === 'email_in' && c.contact_name ? `${c.contact_name} — ` : ''}${text.replace(/\s+/g, ' ').trim() || '(empty)'}`, 240),
      who: c.created_by ? names.get(c.created_by) ?? null : null,
    })
  }
  for (const list of out.values()) list.sort((x, y) => x.at.localeCompare(y.at))
  return out
}

/**
 * What's happened on each card's job since it was written that matters to
 * it — for the "Since this was written" line on the card, and the question
 * before its steps run. Cards not on a job, or not open, have none.
 */
export async function cardChanges(db: SupabaseClient, tenantId: string, cards: ActionCard[]): Promise<Map<string, JobChange[]>> {
  const open = cards.filter(c => c.job_id && (c.status === 'pending' || c.status === 'failed'))
  const out = new Map<string, JobChange[]>()
  if (!open.length) return out
  const since = open.map(c => c.checked_at ?? c.updated_at).sort()[0]
  const byJob = await jobChanges(db, tenantId, [...new Set(open.map(c => c.job_id!))], since)
  for (const c of open) {
    const { review, flag } = changesFor(c, byJob.get(c.job_id!) ?? [])
    const all = [...review, ...flag].sort((x, y) => x.at.localeCompare(y.at))
    if (all.length) out.set(c.id, all)
  }
  return out
}

// ── The check ──

const DECIDE: Anthropic.Beta.BetaTool = {
  name: 'decide_cards',
  description: 'Say, for every open card listed, whether it still needs doing after what has happened on the job since it was written.',
  input_schema: {
    type: 'object',
    properties: {
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            card_id: { type: 'string' },
            verdict: {
              type: 'string',
              enum: ['still_needed', 'done', 'update', 'duplicate'],
              description: 'still_needed: nothing since changes it. done: what it asks has been done or answered, or no longer matters. update: still needed, but its steps are now wrong or out of date (part done, different person, new facts). duplicate: asks for the same thing as another open card listed.',
            },
            reason: { type: 'string', description: 'One plain sentence the office reads, saying what happened and when: "The BAR and quote were sent to Castle on Thu 6 Nov."' },
            duplicate_of: { type: 'string', description: 'For duplicate: the card_id of the card to keep.' },
          },
          required: ['card_id', 'verdict', 'reason'],
        },
      },
    },
    required: ['decisions'],
  },
}

export const RECHECK_SYSTEM_PROMPT = `You keep the to-do list of Insurance Repair Co (building insurance repairs in Perth) up to date in IRC Master. Each item is an action card: a job to do, written from how the job stood when it was made. Since then, things have happened on the job (emails, notes, documents sent, stage changes). Decide for each open card whether it still needs doing.

- done: only when what the card asks for has clearly happened or been answered (the report it says to send was sent, the person it says to chase replied with what was wanted, a note says it was dealt with), or it plainly no longer matters (the job closed, the work was cancelled). Say what happened and when.
- update: it still needs doing, but the steps on it are now wrong — part of it is done, the facts changed, it's now someone else to write to.
- duplicate: two open cards ask for the same thing. Keep the one with more on it.
- still_needed: anything else. When in doubt, it's still needed: closing something the office still has to do is far worse than leaving a card they can skip.
- A note written by the office counts as what happened ("rang Brett, he's paying the excess Friday" means the chase is done, but the excess isn't paid yet).
- Judge from what's listed and the job file. Don't guess.
- The first message may show LESSONS and PAST CASES where the office put back a card IRC had closed: be more careful in situations like those.
- Call decide_cards once, with a decision for every card.`

type Decision = { card_id: string; verdict: 'still_needed' | 'done' | 'update' | 'duplicate'; reason: string; duplicate_of?: string }

export type RecheckResult = { jobId: string; reviewed: number; closed: number; updated: number; aiCall: boolean }

const now = () => new Date().toISOString()

function cardBrief(c: ActionCard, review: JobChange[], flag: JobChange[]): string {
  const steps = c.steps.length ? c.steps.map((s, i) => `   ${i + 1}. ${s.summary}${s.status ? ` (${s.status})` : ''}`).join('\n') : '   (no steps)'
  const kind = c.source === 'followup'
    ? c.follow_up?.kind === 'waiting_on' ? 'Waiting-on chase IRC set' : c.follow_up?.kind === 'watch' ? 'A check IRC planned' : 'A reminder the office set'
    : c.source === 'appointment' ? 'Appointment check-in' : 'From an email'
  const since = [...review, ...flag].sort((x, y) => x.at.localeCompare(y.at)).map(ch => `   - ${changeLine(ch)}`).join('\n')
  return `card_id: ${c.id}
${kind}, written ${perth(c.checked_at ?? c.updated_at)}${c.starred_by ? ' (the user starred it themselves)' : ''}
Title: ${c.title}
${c.description ? `Summary: ${clip(c.description.replace(/\s+/g, ' '), 600)}\n` : ''}${c.follow_up?.note ? `Reminder: "${clip(c.follow_up.note, 300)}"\n` : ''}Steps:
${steps}
Happened on the job since:
${since || '   (nothing)'}`
}

/** AI checks this company has had today (Perth day) */
async function checksToday(db: SupabaseClient, tenantId: string, at: Date): Promise<number> {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(at)
  const start = new Date(`${day}T00:00:00+08:00`).toISOString()
  const { count } = await db.from('ai_calls').select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).eq('feature', AI_FEATURE).gte('created_at', start)
  return count ?? 0
}

/** Checks one job's open cards against what's happened since they were written. Never throws */
export async function recheckJob(
  db: SupabaseClient,
  tenantId: string,
  jobId: string,
  opts: { client?: Pick<Anthropic, 'beta'>; at?: Date } = {},
): Promise<RecheckResult> {
  const result: RecheckResult = { jobId, reviewed: 0, closed: 0, updated: 0, aiCall: false }
  const at = opts.at ?? new Date()
  try {
    const { data: job } = await db.from('jobs').select('id, job_number, insurer').eq('tenant_id', tenantId).eq('id', jobId).maybeSingle()
    const j = job as { id: string; job_number: string; insurer: string | null } | null
    // Midcity's jobs are another business's (lib/jobs/field-app.ts)
    if (!j || isFieldAppJob(j)) return result
    const { data } = await db.from('action_queue').select(CARD_COLUMNS)
      .eq('tenant_id', tenantId).eq('job_id', jobId).in('status', ['pending', 'failed'])
    const cards = (data as ActionCard[] | null) ?? []
    if (!cards.length) return result
    const since = cards.map(c => c.checked_at ?? c.updated_at).sort()[0]
    const changes = (await jobChanges(db, tenantId, [jobId], since)).get(jobId) ?? []
    const weighed = cards.map(c => ({ card: c, ...changesFor(c, changes) }))
    // Nothing that could have done any of them: the cards just show what happened
    if (!weighed.some(w => w.review.length)) return result
    if (!process.env.ANTHROPIC_API_KEY && !opts.client) return result
    if (await checksToday(db, tenantId, at) >= DAILY_CAP) return result

    const ctx: McpContext = { supabase: db as unknown as SupabaseClient<Database>, tenantId, userId: await cardActor(db, tenantId), via: 'chat' }
    const jobFile = (await getJobSummary.run({ job_number: j.job_number }, ctx)).text
    const situation = cards[0].situation ?? { kind: 'job', insurer: j.insurer }
    const [lessons, cases] = await Promise.all([
      activeLessons(db, tenantId, FEATURE),
      similarCases(db, { tenantId, feature: FEATURE, situation, likeness: CARD_LIKENESS }),
    ])
    const learning = [formatLessons(lessons), formatCases(cases)].filter(Boolean).join('\n\n')
    const today = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(at)
    const content = `Today: ${today}.\n\nJOB ${j.job_number}\n\nTHE OPEN CARDS\n\n${weighed.map(w => cardBrief(w.card, w.review, w.flag)).join('\n\n')}\n\nTHE JOB FILE (as it is now)\n${jobFile}${learning ? `\n\n${learning}` : ''}`

    const client = opts.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    result.aiCall = true
    const response = await trackAi({ feature: AI_FEATURE, provider: 'anthropic', model: RECHECK_MODEL, tenantId, jobId }, () => client.beta.messages.create({
      model: RECHECK_MODEL,
      max_tokens: 2000,
      system: RECHECK_SYSTEM_PROMPT,
      tools: [DECIDE],
      tool_choice: { type: 'tool', name: DECIDE.name },
      messages: [{ role: 'user', content }],
    } as Anthropic.Beta.MessageCreateParamsNonStreaming))
    const call = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === DECIDE.name)
    const decisions = ((call?.input as { decisions?: unknown } | undefined)?.decisions)
    if (!Array.isArray(decisions)) {
      await logError('card-recheck', new Error('The AI\'s answer had no decisions'), { tenantId, detail: { jobId } })
      return result
    }

    const byId = new Map(cards.map(c => [c.id, c]))
    const decided = new Set<string>()
    for (const raw of decisions as Decision[]) {
      const card = raw && typeof raw.card_id === 'string' ? byId.get(raw.card_id) : undefined
      if (!card || decided.has(card.id)) continue
      decided.add(card.id)
      result.reviewed++
      const reason = typeof raw.reason === 'string' ? clip(raw.reason.trim(), 400) : ''
      const outcome = await applyDecision(db, card, raw.verdict, reason, typeof raw.duplicate_of === 'string' && byId.has(raw.duplicate_of) && raw.duplicate_of !== card.id ? byId.get(raw.duplicate_of)! : null, at)
      if (outcome === 'closed') result.closed++
      if (outcome === 'updated') result.updated++
    }
    // Every card was looked at as of now, decided or not
    await db.from('action_queue').update({ checked_at: at.toISOString() })
      .in('id', cards.filter(c => !decided.has(c.id)).map(c => c.id)).in('status', ['pending', 'failed'])
    return result
  } catch (err) {
    await logError('card-recheck', err, { tenantId, detail: { jobId } })
    return result
  }
}

/** Does what the check decided for one card */
async function applyDecision(db: SupabaseClient, card: ActionCard, verdict: Decision['verdict'], reason: string, keep: ActionCard | null, at: Date): Promise<'closed' | 'updated' | 'kept'> {
  const checked = { checked_at: at.toISOString() }
  // Steps already run (a reply sent from the card): the rest are the office's call
  const partDone = card.steps.some(s => s.ran_at)
  // A card the user starred stays until they clear it: it just says so
  if ((verdict === 'done' || verdict === 'duplicate') && (card.starred_by || partDone)) {
    const note = verdict === 'done' ? `IRC thinks this may be done: ${reason}` : `IRC thinks this is the same as "${keep?.title ?? 'another card'}".`
    await db.from('action_queue').update({ ...checked, description: [note, card.description].filter(Boolean).join('\n\n') })
      .eq('id', card.id).in('status', ['pending', 'failed'])
    return 'kept'
  }
  if (verdict === 'done' || (verdict === 'duplicate' && keep)) {
    const outcome = verdict === 'done' ? `${LOOKS_DONE}${reason || 'what it asked for has happened'}` : `${SAME_AS}"${clip(keep!.title, 120)}"`
    const { data } = await db.from('action_queue')
      .update({ ...checked, status: verdict === 'done' ? 'done' : 'no_action', outcome, error_log: null, updated_at: now() })
      .eq('id', card.id).in('status', ['pending', 'failed']).select('id').maybeSingle()
    if (data) {
      const { discardStepDrafts } = await import('./steps')
      await discardStepDrafts(card, db)
      if (card.follow_up?.kind === 'waiting_on') {
        const { recordWaitEnded } = await import('./waits')
        await recordWaitEnded(db, card, 'answered', null).catch(() => {})
      }
    }
    return data ? 'closed' : 'kept'
  }
  if (verdict === 'update' && !partDone) {
    // Made again from the job as it is now, with what's changed in front of it
    const { data: won } = await db.from('action_queue').update({ status: 'generating', updated_at: now() })
      .eq('id', card.id).in('status', ['pending', 'failed']).select(CARD_COLUMNS).maybeSingle()
    if (!won) return 'kept'
    const { discardStepDrafts } = await import('./steps')
    await discardStepDrafts(card, db)
    const { generateCard } = await import('./propose')
    await generateCard(won as ActionCard, { db, since: reason })
    return 'updated'
  }
  await db.from('action_queue').update(checked).eq('id', card.id).in('status', ['pending', 'failed'])
  return 'kept'
}

/**
 * The minute cron: checks the jobs that changed and have since gone quiet
 * with nobody on them. Each job is taken once (a change after it was taken
 * marks it again).
 */
export async function recheckChangedJobs({ db = mailDb(), budgetMs = 60_000, client, at }: { db?: SupabaseClient; budgetMs?: number; client?: Pick<Anthropic, 'beta'>; at?: Date } = {}): Promise<RecheckResult[]> {
  const started = Date.now()
  const out: RecheckResult[] = []
  const { data } = await db.from('job_card_rechecks').select('job_id, tenant_id, first_change_at, last_change_at')
    .order('last_change_at', { ascending: true }).limit(50)
  const rows = (data as { job_id: string; tenant_id: string; first_change_at: string; last_change_at: string }[] | null) ?? []
  if (!rows.length) return out
  const { data: seen } = await db.from('job_presence').select('job_id, seen_at').in('job_id', rows.map(r => r.job_id))
  const lastSeen = new Map<string, string>()
  for (const s of (seen as { job_id: string; seen_at: string }[] | null) ?? []) {
    if (!lastSeen.has(s.job_id) || s.seen_at > lastSeen.get(s.job_id)!) lastSeen.set(s.job_id, s.seen_at)
  }
  for (const row of rows) {
    if (Date.now() - started > budgetMs) break
    if (!readyToCheck(row, lastSeen.get(row.job_id) ?? null, at ?? new Date())) continue
    // Taken as it was seen: a change since leaves it for next time
    const { data: taken } = await db.from('job_card_rechecks').delete()
      .eq('job_id', row.job_id).eq('last_change_at', row.last_change_at).select('job_id')
    if (!((taken as unknown[] | null) ?? []).length) continue
    out.push(await recheckJob(db, row.tenant_id, row.job_id, { client, at }))
  }
  return out
}

/** Leaves out presence older than a day (the cron, now and then) */
export async function clearOldPresence(db: SupabaseClient, at = new Date()): Promise<void> {
  await db.from('job_presence').delete().lt('seen_at', new Date(at.getTime() - 86_400_000).toISOString())
}

/** The job page says it's open (every minute while it's on screen) */
export async function markJobOpen(db: SupabaseClient, tenantId: string, jobId: string, userId: string): Promise<void> {
  await db.from('job_presence').upsert({ job_id: jobId, user_id: userId, tenant_id: tenantId, seen_at: now() }, { onConflict: 'job_id,user_id' })
}

/**
 * A card IRC closed as done (or the same as another) put back on the list by
 * a person: the check was wrong, and that's learned from.
 */
export async function recordRecheckUndone(db: SupabaseClient, card: ActionCard, userId: string | null): Promise<void> {
  if (!card.outcome || !(card.outcome.startsWith(LOOKS_DONE) || card.outcome.startsWith(SAME_AS))) return
  const situation = card.situation ?? { kind: card.source }
  await recordLearning(db, {
    tenantId: card.tenant_id,
    feature: FEATURE,
    sourceTable: 'action_queue',
    sourceId: card.id,
    situation,
    situationText: `${situationText(situation)} — card "${card.title}"`,
    proposed: { verdict: card.outcome.startsWith(LOOKS_DONE) ? 'done' : 'duplicate', reason: card.outcome },
    final: { verdict: 'still_needed' },
    changes: [`IRC closed it (${card.outcome}) — the office put it back on the list: it still needed doing`],
    outcome: 'edited',
    userId,
  })
}
