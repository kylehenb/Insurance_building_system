import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { McpContext } from '@/lib/mcp/server'
import { getJobSummary } from '@/lib/mcp/tools/jobs'
import { isFieldAppJob } from '@/lib/jobs/field-app'
import { trackAi } from '@/lib/health/ai-usage'
import { logError } from '@/lib/health/errors'
import { activeLessons, formatLessons } from '@/lib/learning/lessons'
import { formatCases, similarCases } from '@/lib/learning/events'
import { mailDb } from '@/lib/mail/sync'
import { CARD_COLUMNS, cardActor, isPersonsOwn, type ActionCard } from './cards'
import { CARD_LIKENESS } from './learning'
import { AI_FEATURE, changeLine, changesFor, clip, FEATURE, jobChanges, LOOKS_DONE, perth, SAME_AS, type JobChange } from './recheck-rules'

export * from './recheck-rules'

// Out-of-date action cards (tech spec §23.17) — the check itself, server only
// (the free rules the card list and confirming share are recheck-rules.ts).
// A card is written from the job
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
/** No change on the job for this long: it's gone quiet */
export const QUIET_MS = 10 * 60_000
/** The job page says it's open every minute; seen within this, someone's on it */
export const PRESENT_MS = 3 * 60_000
/** Checked by then whatever, so a job left open all day still gets looked at */
export const MAX_WAIT_MS = 3 * 3_600_000
/** AI checks a company gets a day — a busy day can't run up the bill */
export const DAILY_CAP = 80

/** Whether a marked job is ready to be checked: quiet, and nobody has it open (or it's waited long enough) */
export function readyToCheck(row: { first_change_at: string; last_change_at: string }, lastSeen: string | null, at = new Date()): boolean {
  const now = at.getTime()
  if (now - Date.parse(row.first_change_at) >= MAX_WAIT_MS) return true
  if (now - Date.parse(row.last_change_at) < QUIET_MS) return false
  return !lastSeen || now - Date.parse(lastSeen) >= PRESENT_MS
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
    ? c.follow_up?.kind === 'todo' ? 'A to-do the office added'
    : c.follow_up?.kind === 'waiting_on' ? 'Waiting-on chase IRC set' : c.follow_up?.kind === 'watch' ? 'A check IRC planned' : 'A reminder the office set'
    : c.source === 'appointment' ? 'Appointment check-in' : 'From an email'
  const since = [...review, ...flag].sort((x, y) => x.at.localeCompare(y.at)).map(ch => `   - ${changeLine(ch)}`).join('\n')
  return `card_id: ${c.id}
${kind}, written ${perth(c.checked_at ?? c.updated_at)}${isPersonsOwn(c) ? ' (the office\'s own — say done only if it clearly happened)' : ''}
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
  // A card the user starred, or a to-do or reminder they set, stays until they clear it: it just says so
  if ((verdict === 'done' || verdict === 'duplicate') && (isPersonsOwn(card) || partDone)) {
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
  if (verdict === 'update' && !partDone && card.follow_up?.kind !== 'todo') {
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
