import type { SupabaseClient } from '@supabase/supabase-js'
import { isoToPerthLocal, parseSendAt, perthLocalToIso, spokenSendAt } from '@/lib/mail/schedule-rules'
import { CardError, CARD_COLUMNS, PRIORITY, type ActionCard, type FollowUp, type WaitingOn } from './cards'

// Follow-ups (tech spec §23.11): "remind me in a week to chase the roofer".
// One is an action card with a date: it waits (status scheduled) until
// due_at, then the minute cron queues it (releaseDueFollowUps) and the AI
// drafts the next steps from where the job stands then — a chase email for
// the office to send, a note — like any other card. Nothing goes out by
// itself. Set from a card or the job page (Remind me), by voice or chat
// (set_follow_up), or as a step the AI suggests on a card.
// Pure apart from the database calls — the date helpers are safe for client code.

/** A follow-up set for a day comes onto the list at the start of that day */
const START_OF_DAY = '08:00'
const MAX_NOTE = 2000
const MAX_WHO = 200
const DAY_MS = 86_400_000

const perthToday = (now: Date) => isoToPerthLocal(now.toISOString()).slice(0, 10)

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().slice(0, 10)
}

/** That Perth day at the start of the office day */
export const followUpDay = (date: string) => perthLocalToIso(`${date}T${START_OF_DAY}`)

/**
 * When a follow-up is due, from what the person said: a number of days
 * ("7", "7 days"), weeks or months ("2 weeks", "1 month"), a Perth date
 * ("2026-11-02", 8am that day) or a Perth date and time. Null if unreadable.
 */
export function parseFollowUpWhen(value: unknown, now = new Date()): string | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? followUpDay(addDays(perthToday(now), Math.round(value))) : null
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  const n = v.match(/^(?:in\s+)?(\d{1,3})\s*(d|days?|w|weeks?|m|months?)?$/)
  if (n) {
    const count = Number(n[1])
    if (!count) return null
    const unit = n[2]?.[0] ?? 'd'
    const day = unit === 'm' ? addMonths(perthToday(now), count) : addDays(perthToday(now), unit === 'w' ? count * 7 : count)
    return followUpDay(day)
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return followUpDay(v)
  return parseSendAt(value)
}

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay()
const isWeekend = (date: string) => weekday(date) === 0 || weekday(date) === 6

/** The next Monday to Friday on or after this Perth day */
export function nextWorkingDay(date: string): string {
  let d = date
  while (isWeekend(d)) d = addDays(d, 1)
  return d
}

/**
 * When to chase something asked for now: that many working days on, at the
 * start of the office day (0: in a few hours, or first thing the next working
 * day if that's after hours or the weekend).
 */
export function chaseDue(workingDays: number, now = new Date()): string {
  const today = perthToday(now)
  if (workingDays <= 0) {
    const soon = new Date(now.getTime() + 3 * 3_600_000)
    const local = isoToPerthLocal(soon.toISOString())
    const hour = Number(local.slice(11, 13))
    if (local.slice(0, 10) === today && !isWeekend(today) && hour >= 8 && hour < 17) return soon.toISOString()
    return followUpDay(nextWorkingDay(addDays(today, 1)))!
  }
  let d = today
  for (let left = Math.round(workingDays); left > 0;) {
    d = addDays(d, 1)
    if (!isWeekend(d)) left--
  }
  return followUpDay(d)!
}

/** Working days from one time to another (Perth days, Monday to Friday), for saying how long a wait was */
export function workingDaysBetween(fromIso: string, toIso: string): number {
  let d = isoToPerthLocal(fromIso).slice(0, 10)
  const end = isoToPerthLocal(toIso).slice(0, 10)
  let n = 0
  while (d < end) {
    d = addDays(d, 1)
    if (!isWeekend(d)) n++
  }
  return n
}

/** The quick choices in Remind me */
export function followUpPresets(now = new Date()): { label: string; at: string }[] {
  const today = perthToday(now)
  return [
    { label: 'In 3 days', at: followUpDay(addDays(today, 3))! },
    { label: 'In a week', at: followUpDay(addDays(today, 7))! },
    { label: 'In 2 weeks', at: followUpDay(addDays(today, 14))! },
    { label: 'In a month', at: followUpDay(addMonths(today, 1))! },
  ]
}

/** "Mon 2 Nov", with the time only when it isn't the start of the day */
export function spokenDue(iso: string): string {
  const spoken = spokenSendAt(iso)
  return isoToPerthLocal(iso).endsWith(`T${START_OF_DAY}`) ? spoken.replace(/, [^,]*$/, '') : spoken
}

export type NewFollowUp = {
  jobId: string | null
  note: string
  who?: string | null
  dueAt: string
  /** The conversation it's about (the card it was set from, or one named by voice) */
  threadId?: string | null
  /** The card it was set from */
  fromCardId?: string | null
  /** Take that card off the list until then (it's dealt with for now) */
  clearCard?: boolean
  /** Set by IRC from an email the office sent (lib/actions/waiting-on.ts) */
  waiting?: WaitingOn
  urgent?: boolean
}

/** A follow-up's title: what it's for, and with whom */
export function followUpTitle(f: Pick<FollowUp, 'note' | 'who' | 'waiting'>): string {
  if (f.waiting) return `Waiting on ${f.waiting.name}: ${clip(f.waiting.asked, 80)}`
  return `Follow up${f.who ? ` with ${f.who}` : ''}: ${clip(f.note.split('\n')[0], 80)}`
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const now = () => new Date().toISOString()

export async function createFollowUp(db: SupabaseClient, tenantId: string, userId: string | null, input: NewFollowUp): Promise<ActionCard> {
  const note = input.note.trim().slice(0, MAX_NOTE)
  if (!note) throw new CardError('What should the follow-up be?')
  const due = new Date(input.dueAt)
  if (Number.isNaN(due.getTime())) throw new CardError('When should it be? Give a date.')
  if (due.getTime() < Date.now() + 60_000) throw new CardError('Choose a time in the future')
  if (input.jobId) {
    const { data: job } = await db.from('jobs').select('id').eq('tenant_id', tenantId).eq('id', input.jobId).maybeSingle()
    if (!job) throw new CardError('Job not found', 404)
  }
  const threadId = input.threadId && /^[0-9a-f]+$/i.test(input.threadId) ? input.threadId : null
  const who = input.who?.trim().slice(0, MAX_WHO) || null
  const followUp: FollowUp = {
    note, who, thread_id: threadId, from_card_id: input.fromCardId ?? null, created_by: userId,
    ...(input.waiting ? { kind: 'waiting_on' as const, waiting: input.waiting } : {}),
  }

  const { data, error } = await db.from('action_queue').insert({
    tenant_id: tenantId,
    job_id: input.jobId,
    source: 'followup',
    rule_key: input.waiting ? 'waiting_on' : 'followup',
    title: followUpTitle(followUp),
    description: note,
    status: 'scheduled',
    priority: input.urgent ? PRIORITY.high : PRIORITY.normal,
    category: 'other',
    due_at: due.toISOString(),
    follow_up: followUp,
  }).select(CARD_COLUMNS).single()
  if (error) throw new Error(error.message)

  // Dealt with for now: the card comes off the list until the follow-up
  if (input.fromCardId && input.clearCard) {
    await db.from('action_queue')
      .update({ status: 'done', outcome: `Follow-up set for ${spokenDue(due.toISOString())}`, confirmed_by: userId, confirmed_at: now(), updated_at: now() })
      .eq('tenant_id', tenantId).eq('id', input.fromCardId).in('status', ['pending', 'failed', 'queued'])
  }
  return data as ActionCard
}

/**
 * Moves a waiting follow-up, or changes what it says. A waiting-on
 * follow-up moved by a person is learned from (lib/actions/waiting-on.ts).
 */
export async function updateFollowUp(
  db: SupabaseClient, tenantId: string, id: string,
  changes: { dueAt?: string; note?: string; who?: string | null },
  /** Who changed it */
  userId: string | null = null,
): Promise<ActionCard> {
  const patch: Record<string, unknown> = {}
  if (changes.dueAt !== undefined) {
    const due = new Date(changes.dueAt)
    if (Number.isNaN(due.getTime()) || due.getTime() < Date.now() + 60_000) throw new CardError('Choose a time in the future')
    patch.due_at = due.toISOString()
  }
  const { data: row } = await db.from('action_queue').select(CARD_COLUMNS)
    .eq('tenant_id', tenantId).eq('id', id).eq('source', 'followup').maybeSingle()
  const current = row as ActionCard | null
  if (!current) throw new CardError('Follow-up not found', 404)
  if (current.status !== 'scheduled') throw new CardError('That follow-up is already on the list', 409)
  if (changes.note !== undefined || changes.who !== undefined) {
    const note = (changes.note ?? current.follow_up?.note ?? '').trim().slice(0, MAX_NOTE)
    if (!note) throw new CardError('What should the follow-up be?')
    const who = changes.who === undefined ? current.follow_up?.who ?? null : changes.who?.trim().slice(0, MAX_WHO) || null
    patch.follow_up = { ...current.follow_up, note, who }
    patch.description = note
    patch.title = followUpTitle({ note, who, waiting: current.follow_up?.waiting })
  }
  if (!Object.keys(patch).length) throw new CardError('Nothing to change')
  const wasDue = current.due_at
  const { data, error } = await db.from('action_queue').update({ ...patch, updated_at: now() })
    .eq('id', id).eq('status', 'scheduled').select(CARD_COLUMNS).single()
  if (error) throw new Error(error.message)
  const card = data as ActionCard
  if (patch.due_at && wasDue && patch.due_at !== wasDue && card.follow_up?.kind === 'waiting_on') {
    const { recordWaitMoved } = await import('./waits')
    await recordWaitMoved(db, card, wasDue, userId)
  }
  return card
}

export async function cancelFollowUp(db: SupabaseClient, tenantId: string, id: string, userId: string): Promise<boolean> {
  const { data } = await db.from('action_queue')
    .update({ status: 'skipped', outcome: 'Follow-up cancelled', confirmed_by: userId, confirmed_at: now(), updated_at: now() })
    .eq('tenant_id', tenantId).eq('id', id).eq('source', 'followup').eq('status', 'scheduled')
    .select(CARD_COLUMNS).maybeSingle()
  const card = data as ActionCard | null
  // Not needed after all: learned from
  if (card?.follow_up?.kind === 'waiting_on') {
    const { recordWaitEnded } = await import('./waits')
    await recordWaitEnded(db, card, 'cancelled', userId)
  }
  return !!card
}

/** Follow-ups now due go on the list: queued for the AI to draft their steps (the minute cron) */
export async function releaseDueFollowUps(db: SupabaseClient, at = new Date()): Promise<number> {
  const { data } = await db.from('action_queue')
    .update({ status: 'queued', attempts: 0, updated_at: at.toISOString() })
    .eq('status', 'scheduled').lte('due_at', at.toISOString())
    .select('id')
  return ((data as { id: string }[] | null) ?? []).length
}
