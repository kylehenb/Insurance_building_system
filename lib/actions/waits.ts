import type { SupabaseClient } from '@supabase/supabase-js'
import { activeLessons, formatLessons } from '@/lib/learning/lessons'
import { formatCases, recordLearning, similarCases, type LearningOutcome, type Likeness, type Situation } from '@/lib/learning/events'
import { CARD_COLUMNS, PRIORITY, type ActionCard, type WaitingOn } from './cards'
import { chaseDue, followUpDay, spokenDue, workingDaysBetween } from './followups'

// What the office is waiting on (tech spec §23.12) — the parts that are only
// database work: the situation a wait is in and what's learned from it, a
// reply closing a wait, the card AI's brief and its "chase sooner", and the
// list for "what am I waiting on?". Reading sent emails (the AI, Gmail) is
// lib/actions/waiting-on.ts.

export const FEATURE = 'waiting_on'

/** Free mail: the domain says nothing about who's writing */
const FREE_MAIL = /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|bigpond|iinet|optusnet|westnet|aol|protonmail)\./i

const now = () => new Date().toISOString()
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export const days = (n: number) => (n === 0 ? 'the same day' : `${n} working day${n === 1 ? '' : 's'}`)

// ── The situation, and what the AI reads from past waits ──

/** Which facts make two waits alike: the same person most, then their company, their trade, the kind of ask */
export const WAIT_LIKENESS: Likeness = {
  weights: { waiting_on_email: 4, waiting_on_domain: 2, trade_type: 2, ask_kind: 1.5, role: 1.5, insurer: 1, stage: 1, job_type: 0.5, loss_type: 0.5 },
  // Broad to start with: any trade's wait counts for a trade until there are closer ones
  minScore: 1.5,
}

type JobFacts = { insurer: string | null; job_type: string | null; current_stage: string | null; loss_type: string | null }

/** The situation a wait is in: who's being waited on (and their trade), for what, and the job */
export async function waitSituation(
  db: SupabaseClient,
  tenantId: string,
  w: { email: string | null; name: string; role: string; ask_kind: string },
  jobId: string | null,
  sentBy: string | null,
): Promise<Situation> {
  const email = w.email?.trim().toLowerCase() || null
  const domain = email?.split('@')[1] ?? null
  const [{ data: job }, { data: trade }, { data: user }] = await Promise.all([
    jobId ? db.from('jobs').select('insurer, job_type, current_stage, loss_type').eq('tenant_id', tenantId).eq('id', jobId).maybeSingle() : Promise.resolve({ data: null }),
    email ? db.from('trades').select('business_name, primary_trade').eq('tenant_id', tenantId).ilike('contact_email', email).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    sentBy ? db.from('users').select('name').eq('id', sentBy).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const j = job as JobFacts | null
  const t = trade as { business_name: string | null; primary_trade: string | null } | null
  return {
    waiting_on_email: email,
    waiting_on_name: t?.business_name || w.name || null,
    waiting_on_domain: domain && !FREE_MAIL.test(domain) ? domain : null,
    role: t ? 'trade' : w.role || null,
    trade_type: t?.primary_trade?.trim() || null,
    ask_kind: w.ask_kind || null,
    insurer: j?.insurer ?? null,
    job_type: j?.job_type ?? null,
    stage: j?.current_stage ?? null,
    loss_type: j?.loss_type ?? null,
    sent_by: (user as { name: string } | null)?.name ?? null,
  }
}

/** One line saying what the wait was */
export function waitText(s: Situation, asked?: string): string {
  const who = [s.waiting_on_name, s.waiting_on_email && `<${s.waiting_on_email}>`].filter(Boolean).join(' ') || 'someone'
  const what = [s.trade_type ? `${s.trade_type} trade` : s.role, s.ask_kind && `asked for ${asked ? `${asked} (${s.ask_kind})` : s.ask_kind}`].filter(Boolean).join(', ')
  const job = [s.insurer, s.job_type, s.loss_type, s.stage && `stage: ${s.stage}`].filter(Boolean).join(', ')
  return `Waiting on ${who}${what ? ` — ${what}` : ''}${job ? ` — ${job}` : ' — not on a job'}${s.sent_by ? ` — sent by ${s.sent_by}` : ''}`
}

/** What the AI reads before setting a chase: the lessons, then the most alike past waits (one line each) */
export async function waitLearning(db: SupabaseClient, tenantId: string, situation: Situation): Promise<string> {
  const [lessons, cases] = await Promise.all([
    activeLessons(db, tenantId, FEATURE),
    similarCases(db, { tenantId, feature: FEATURE, situation, likeness: WAIT_LIKENESS, limit: 12 }),
  ])
  // A wait can be decided on more than once (moved, then answered): its newest decision speaks for it
  const seen = new Set<string>()
  const latest = cases.filter(c => !c.source_id || (!seen.has(c.source_id) && !!seen.add(c.source_id))).slice(0, 6)
  return [formatLessons(lessons), formatCases(latest)].filter(Boolean).join('\n\n')
}

// ── Recording what the office did with a wait (the learning module) ──

async function recordWait(db: SupabaseClient, card: ActionCard, outcome: LearningOutcome, changes: string[], userId: string | null): Promise<void> {
  const w = card.follow_up?.waiting
  if (!w) return
  const situation = w.situation ?? {}
  await recordLearning(db, {
    tenantId: card.tenant_id,
    feature: FEATURE,
    sourceTable: 'action_queue',
    sourceId: card.id,
    situation,
    situationText: waitText(situation, w.asked),
    proposed: { chase_after: days(w.ai_days), due: w.ai_due_at, reason: w.reason },
    final: { due: card.due_at },
    changes,
    outcome,
    // No kind: waits are never auto-confirmed
    kind: null,
    userId,
  })
}

/** A person moved the chase: the AI should have picked that */
export async function recordWaitMoved(db: SupabaseClient, card: ActionCard, from: string, userId: string | null): Promise<void> {
  const w = card.follow_up?.waiting
  if (!w || !card.due_at) return
  const before = workingDaysBetween(w.sent_at, from)
  const after = workingDaysBetween(w.sent_at, card.due_at)
  const sooner = new Date(card.due_at) < new Date(from)
  await recordWait(db, card, 'edited', [
    `The office moved the chase ${sooner ? 'sooner' : 'later'}: from ${spokenDue(from)} (${days(before)} after the email) to ${spokenDue(card.due_at)} (${days(after)} after)`,
  ], userId)
}

/** How a wait ended: answered before the chase, chased, the chase skipped, or cancelled */
export async function recordWaitEnded(
  db: SupabaseClient, card: ActionCard, how: 'answered' | 'chased' | 'chase_skipped' | 'cancelled', userId: string | null, at = new Date(),
): Promise<void> {
  const w = card.follow_up?.waiting
  if (!w) return
  const set = card.due_at ? days(workingDaysBetween(w.sent_at, card.due_at)) : 'a day'
  const took = days(workingDaysBetween(w.sent_at, at.toISOString()))
  const line = {
    answered: `${w.name} replied ${took} after the email, before the chase (set for ${set})`,
    chased: `Nothing came in ${set}: the office sent the chase`,
    chase_skipped: `The chase came up after ${set} and the office skipped it — not needed by then`,
    cancelled: `The office cancelled the wait ${took} after the email — not needed`,
  }[how]
  const outcome: LearningOutcome = how === 'cancelled' || how === 'chase_skipped' ? 'skipped' : 'accepted'
  await recordWait(db, card, outcome, [line], userId)
}

/** A waiting-on follow-up's card was confirmed or skipped once due: how the wait ended */
export async function recordChaseDecision(db: SupabaseClient, card: ActionCard, userId: string | null, ended: 'confirmed' | 'skipped'): Promise<void> {
  if (card.follow_up?.kind !== 'waiting_on') return
  const chased = ended === 'confirmed' && card.steps.some(s => s.tool === 'send_email' && (s.status === 'done' || s.status === 'waiting'))
  await recordWaitEnded(db, card, chased ? 'chased' : 'chase_skipped', userId)
}

// ── The mailbox sync: replies close waits ──

export const WAITING_STATUSES = ['scheduled', 'queued', 'pending', 'failed']

/**
 * New mail in conversations the office is waiting on: the wait is answered.
 * A chase not yet acted on comes off the list too — the reply gets its own
 * card, which says what the office was waiting for.
 */
export async function closeAnsweredWaits(db: SupabaseClient, tenantId: string, received: { messageId: string; threadId: string }[]): Promise<number> {
  if (!received.length) return 0
  const threads = [...new Set(received.map(r => r.threadId))]
  const { data } = await db.from('action_queue').select(CARD_COLUMNS)
    .eq('tenant_id', tenantId).eq('source', 'followup').eq('rule_key', 'waiting_on').in('status', WAITING_STATUSES)
  const waits = ((data as ActionCard[] | null) ?? [])
    .filter(c => c.follow_up?.thread_id && threads.includes(c.follow_up.thread_id))
    .filter(c => !(c.steps ?? []).some(s => s.ran_at))
  let closed = 0
  for (const card of waits) {
    const w = card.follow_up!.waiting
    const { data: won } = await db.from('action_queue')
      .update({ status: 'done', outcome: `Answered — ${w?.name ?? 'they'} replied`, updated_at: now() })
      .eq('id', card.id).in('status', WAITING_STATUSES).select(CARD_COLUMNS).maybeSingle()
    if (!won) continue
    closed++
    await recordWaitEnded(db, won as ActionCard, 'answered', null)
  }
  return closed
}

// ── What the card AI is told, and its "chase sooner" ──

/** A conversation's wait that a reply just answered, for the reply's card. Null if none */
export async function answeredWait(db: SupabaseClient, tenantId: string, threadId: string): Promise<ActionCard | null> {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
  const { data } = await db.from('action_queue').select(CARD_COLUMNS)
    .eq('tenant_id', tenantId).eq('source', 'followup').eq('rule_key', 'waiting_on').eq('status', 'done')
    .gte('updated_at', since).order('updated_at', { ascending: false }).limit(20)
  return ((data as ActionCard[] | null) ?? []).find(c => c.follow_up?.thread_id === threadId && c.outcome?.startsWith('Answered')) ?? null
}

/** The waits still open on a job, other than in this conversation */
export async function openWaits(db: SupabaseClient, tenantId: string, jobId: string, exceptThread: string | null = null): Promise<ActionCard[]> {
  const { data } = await db.from('action_queue').select(CARD_COLUMNS)
    .eq('tenant_id', tenantId).eq('job_id', jobId).eq('source', 'followup').eq('rule_key', 'waiting_on').eq('status', 'scheduled')
    .order('due_at', { ascending: true }).limit(10)
  return ((data as ActionCard[] | null) ?? []).filter(c => !exceptThread || c.follow_up?.thread_id !== exceptThread)
}

/** "Thu 29 Oct" */
export const sentOn = (iso: string) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso)).replace(',', '')

/** One line for a wait, as the AI and the office read it */
export function waitLine(card: ActionCard): string {
  const w = card.follow_up?.waiting
  if (!w) return card.title
  return `${w.name} — ${w.asked} (asked ${sentOn(w.sent_at)}${card.due_at ? `, chase ${spokenDue(card.due_at)}` : ''})${w.on_behalf_of ? `. ${w.on_behalf_of}` : ''}`
}

/** For an email card's first message: the wait this email answered, and the job's other open waits */
export async function waitBrief(db: SupabaseClient, tenantId: string, threadId: string, jobId: string | null): Promise<string> {
  const [answered, open] = await Promise.all([
    answeredWait(db, tenantId, threadId),
    jobId ? openWaits(db, tenantId, jobId, threadId) : Promise.resolve([]),
  ])
  const parts: string[] = []
  if (answered) {
    parts.push(`THE OFFICE WAS WAITING ON THIS REPLY\n${waitLine(answered)}\nThe reply closed that reminder. If it doesn't actually give what was asked for (e.g. "I'll send it Friday"), propose set_follow_up for when it should have come (who, what, when), so the office isn't left waiting.`)
  }
  if (open.length) {
    parts.push(`THE OFFICE IS ALSO WAITING ON (other conversations on this job)\n${open.map(c => `- follow_up_id ${c.id}: ${waitLine(c)}`).join('\n')}\nIf this email makes one of these more urgent (the insurer or homeowner chasing it, a complaint, a deadline, something gone wrong), put it in finish_card's chase_sooner with when to chase and why. Leave chase_sooner empty otherwise.`)
  }
  return parts.join('\n\n')
}

/**
 * Brings a wait's chase forward — never later. "now" (or a time already
 * past) puts it on the action cards at the next minute. Returns whether it moved.
 */
export async function bringForward(db: SupabaseClient, tenantId: string, id: string, when: string, reason: string, at = new Date()): Promise<boolean> {
  const { data } = await db.from('action_queue').select(CARD_COLUMNS)
    .eq('tenant_id', tenantId).eq('id', id).eq('rule_key', 'waiting_on').eq('status', 'scheduled').maybeSingle()
  const card = data as ActionCard | null
  if (!card?.due_at || !card.follow_up?.waiting) return false
  const v = when.trim().toLowerCase()
  const target = v === 'now' || v === 'today' ? at.toISOString()
    : /^\d+$/.test(v) ? chaseDue(Number(v), at)
    : /^\d{4}-\d{2}-\d{2}$/.test(v) ? followUpDay(v)
    : null
  if (!target) return false
  const due = new Date(Math.max(new Date(target).getTime(), at.getTime() + 60_000)).toISOString()
  if (due >= card.due_at) return false
  const waiting: WaitingOn = { ...card.follow_up.waiting, brought_forward: [...(card.follow_up.waiting.brought_forward ?? []), { at: at.toISOString(), to: due, reason: clip(reason.trim() || 'A later email made it more urgent', 300) }] }
  const { data: moved } = await db.from('action_queue')
    .update({ due_at: due, priority: PRIORITY.high, follow_up: { ...card.follow_up, waiting }, updated_at: now() })
    .eq('id', card.id).eq('status', 'scheduled').select('id').maybeSingle()
  return !!moved
}

// ── "What am I waiting on?" ──

/** Open waits — still waiting, or their chase on the action cards — for one person or everyone, soonest chase first */
export async function listWaits(db: SupabaseClient, tenantId: string, { userId = null, jobId = null, limit = 50 }: { userId?: string | null; jobId?: string | null; limit?: number } = {}): Promise<ActionCard[]> {
  let q = db.from('action_queue').select(CARD_COLUMNS)
    .eq('tenant_id', tenantId).eq('source', 'followup').eq('rule_key', 'waiting_on').in('status', WAITING_STATUSES)
  if (jobId) q = q.eq('job_id', jobId)
  const { data, error } = await q.order('due_at', { ascending: true }).limit(500)
  if (error) throw new Error(error.message)
  return ((data as ActionCard[] | null) ?? [])
    .filter(c => !!c.follow_up?.waiting && (!userId || c.follow_up.created_by === userId))
    .slice(0, limit)
}
