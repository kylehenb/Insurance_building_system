import type { SupabaseClient } from '@supabase/supabase-js'
import type { Situation } from '@/lib/learning/events'
import type { Arrivals } from '@/lib/mail/summary'
import { recordCardDecision } from './learning'
import { orderUpdateThreads } from '@/lib/insurer-orders/order-update'

// Action cards (tech spec §19, §23.11): the AI's suggested next steps,
// stored in action_queue. This file is the card lifecycle — queueing a card
// when an email arrives, claiming queued cards for generation
// (lib/actions/propose.ts), stars and categories, skip, and reading them for
// the page. Confirming runs the steps (lib/actions/confirm.ts).
//
// A live card is the email's star: it needs doing. Its category is the
// star's symbol. A star the user set or changed (starred_by) keeps its
// category and stays until they clear it.

export class CardError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 = 400) {
    super(message)
    this.name = 'CardError'
  }
}

export type StepKind = 'email' | 'filing' | 'change'
export type StepStatus = 'done' | 'failed' | 'waiting' | 'skipped'

/** An email step opened in the composer: its Gmail draft, and what it says now (for the card) */
export type StepDraft = { id: string; to: string; cc: string; bcc: string; subject: string; html: string }

export type CardStep = {
  id: string
  /** A voice connector tool (lib/mcp/tools) */
  tool: string
  args: Record<string, unknown>
  summary: string
  kind: StepKind
  status?: StepStatus
  result?: string
  ran_at?: string
  /** An email step edited in the composer: sending sends this draft */
  draft?: StepDraft
}

/** scheduled: a follow-up waiting for its date (due_at) */
export type CardStatus = 'scheduled' | 'queued' | 'generating' | 'pending' | 'running' | 'done' | 'skipped' | 'no_action' | 'failed'

export type CardCategory = 'invoice' | 'attend_submit' | 'other'

/** The star symbols, in the order a click cycles through them */
export const CATEGORIES: { key: CardCategory; label: string }[] = [
  { key: 'invoice', label: 'Invoices to pay' },
  { key: 'attend_submit', label: 'Attend and Submit' },
  { key: 'other', label: 'Everything else' },
]

export const isCategory = (v: unknown): v is CardCategory => CATEGORIES.some(c => c.key === v)

/** The next star after this one; null after the last (the star comes off) */
export function nextCategory(current: CardCategory | null): CardCategory | null {
  if (!current) return CATEGORIES[0].key
  const i = CATEGORIES.findIndex(c => c.key === current)
  return CATEGORIES[i + 1]?.key ?? null
}

/** What a follow-up is for, as the person set it (lib/actions/followups.ts) */
export type FollowUp = {
  note: string
  /** Who to follow up with, in their words: "Ace Roofing", "the insured" */
  who: string | null
  /** The conversation it came from, if any */
  thread_id: string | null
  from_card_id: string | null
  /** Who it's for: who set it, or who sent the email a waiting-on follow-up came from */
  created_by: string | null
  /** waiting_on: set by IRC from an email the office sent (lib/actions/waiting-on.ts) */
  kind?: 'waiting_on'
  waiting?: WaitingOn
}

/** A waiting-on follow-up: who was asked for what, and why the chase is when it is */
export type WaitingOn = {
  name: string
  email: string | null
  /** trade, insurer, assessor, insured, supplier, other */
  role: string
  /** What they were asked for, in a few words: "the switchboard photos" */
  asked: string
  /** information, photos, quote, invoice, report, booking, approval, documents, other */
  ask_kind: string
  /** Who's waiting on the office for it, if anyone: "Suncorp asked on 28 Oct" */
  on_behalf_of: string | null
  /** The email that asked */
  message_id: string
  sent_at: string
  /** The chase as the AI set it, in working days after the email — what a person changes is learned from */
  ai_days: number
  ai_due_at: string
  reason: string
  /** Moved sooner by the AI when a later email made it more urgent */
  brought_forward?: { at: string; to: string; reason: string }[]
  /** Who, what and the job, for the learning module (the card's own situation is the chase card's) */
  situation: Situation
}

export type ActionCard = {
  id: string
  tenant_id: string
  job_id: string | null
  source: string
  source_ref: string | null
  trigger_ref: string | null
  title: string
  description: string | null
  reasoning: string | null
  steps: CardStep[]
  status: CardStatus
  category: CardCategory
  /** Set when the user starred or re-starred it themselves */
  starred_by: string | null
  priority: number | null
  outcome: string | null
  error_log: string | null
  attempts: number
  created_at: string
  updated_at: string
  /** A follow-up: when it comes onto the list */
  due_at: string | null
  follow_up: FollowUp | null
  /** The steps as the AI proposed them — what the office changed is learned from (lib/actions/learning.ts) */
  ai_steps: CardStep[] | null
  /** What the card was made about: sender, insurer, job stage… (lib/actions/learning.ts) */
  situation: Situation | null
}

/** Cards that can still change: one per conversation (see the unique index) */
export const LIVE_STATUSES: CardStatus[] = ['queued', 'generating', 'pending', 'failed']

export const CARD_COLUMNS = 'id, tenant_id, job_id, source, source_ref, trigger_ref, title, description, reasoning, steps, status, category, starred_by, priority, outcome, error_log, attempts, created_at, updated_at, due_at, follow_up, ai_steps, situation'

/** Priority from the model's high / normal / low */
export const PRIORITY = { high: 90, normal: 50, low: 20 } as const

const MAX_ATTEMPTS = 3
const STUCK_MS = 10 * 60_000

const now = () => new Date().toISOString()

/** The person cards and the waiting-on reader read as (reads only): the company's first admin */
export async function cardActor(db: SupabaseClient, tenantId: string): Promise<string> {
  const { data } = await db.from('users').select('id').eq('tenant_id', tenantId).eq('role', 'admin')
    .order('created_at', { ascending: true }).limit(1)
  return ((data as { id: string }[] | null) ?? [])[0]?.id ?? ''
}

async function liveCard(db: SupabaseClient, tenantId: string, threadId: string): Promise<ActionCard | null> {
  const { data } = await db.from('action_queue').select(CARD_COLUMNS)
    .eq('tenant_id', tenantId).eq('source', 'email').eq('source_ref', threadId)
    .in('status', LIVE_STATUSES).maybeSingle()
  return (data as ActionCard | null) ?? null
}

/** Queues (or re-queues) the card for a conversation that just got an email */
export async function queueEmailCard(db: SupabaseClient, tenantId: string, threadId: string, messageId: string | null): Promise<string | null> {
  const live = await liveCard(db, tenantId, threadId)
  if (live) {
    if (messageId && live.trigger_ref === messageId) return live.id
    // A new email on it: read it again, with the latest
    if (live.status === 'generating') return live.id
    await db.from('action_queue')
      .update({ status: 'queued', trigger_ref: messageId ?? live.trigger_ref, attempts: 0, error_log: null, updated_at: now() })
      .eq('id', live.id)
    return live.id
  }
  const { data, error } = await db.from('action_queue').insert({
    tenant_id: tenantId,
    source: 'email',
    source_ref: threadId,
    trigger_ref: messageId,
    rule_key: 'email',
    title: 'Reading the email…',
    status: 'queued',
    priority: PRIORITY.normal,
  }).select('id').single()
  // Another run queued it at the same moment
  if (error) return (await liveCard(db, tenantId, threadId))?.id ?? null
  return (data as { id: string }).id
}

/**
 * What a mailbox sync saw: new incoming mail queues its conversation's
 * card; a send from us in a conversation means it's been dealt with —
 * unless the user starred it themselves (an invoice to pay isn't paid by
 * replying), which stays until they clear it, or it's an insurer's order
 * email on a claim that already has an order (lib/insurer-orders/order-update).
 */
export async function onMailArrivals(db: SupabaseClient, tenantId: string, arrivals: Arrivals | undefined): Promise<number> {
  if (!arrivals) return 0
  // What the office is waiting on (lib/actions/waiting-on.ts): sends to read
  // for what they ask, and replies that answer them
  const { closeAnsweredWaits } = await import('./waits')
  const { recordSyncedSends } = await import('@/lib/mail/sent-by')
  await recordSyncedSends(db, tenantId, arrivals.sent ?? [])
  await closeAnsweredWaits(db, tenantId, arrivals.received)
  const replied = new Set(arrivals.sentThreadIds)
  let queued = 0
  // Only the newest email per conversation matters
  const newest = new Map<string, string>()
  for (const r of arrivals.received) newest.set(r.threadId, r.messageId)
  for (const [threadId, messageId] of newest) {
    if (replied.has(threadId)) continue
    if (await queueEmailCard(db, tenantId, threadId, messageId)) queued++
  }
  // New instructions on an existing claim aren't done by replying to them (an
  // electrician still has to be allocated): their cards stay until confirmed or skipped
  for (const threadId of await orderUpdateThreads(db, tenantId, [...replied])) replied.delete(threadId)
  if (replied.size) {
    // Not cards part-way through (a reply sent from the card, other steps still to do)
    const { data } = await db.from('action_queue').select('id, steps')
      .eq('tenant_id', tenantId).eq('source', 'email').in('source_ref', [...replied])
      .is('starred_by', null).in('status', ['queued', 'pending', 'failed'])
    const ids = ((data as Pick<ActionCard, 'id' | 'steps'>[] | null) ?? [])
      .filter(c => !(c.steps ?? []).some(s => s.ran_at)).map(c => c.id)
    if (ids.length) {
      await db.from('action_queue')
        .update({ status: 'done', outcome: 'Replied from Mail', updated_at: now() })
        .in('id', ids)
    }
  }
  return queued
}

/**
 * Takes up to `limit` queued cards for generation (status → generating, so
 * overlapping runs don't both make one). Also re-queues generation that was
 * cut off.
 */
export async function claimQueued(db: SupabaseClient, limit: number): Promise<ActionCard[]> {
  const t = now()
  await db.from('action_queue').update({ status: 'queued', updated_at: t })
    .eq('status', 'generating').lt('updated_at', new Date(Date.now() - STUCK_MS).toISOString()).lt('attempts', MAX_ATTEMPTS)
  await db.from('action_queue').update({ status: 'failed', error_log: 'Gave up reading this email after several tries', updated_at: t })
    .eq('status', 'generating').lt('updated_at', new Date(Date.now() - STUCK_MS).toISOString()).gte('attempts', MAX_ATTEMPTS)

  const { data } = await db.from('action_queue').select(CARD_COLUMNS)
    .eq('status', 'queued').order('updated_at', { ascending: true }).limit(limit)
  const claimed: ActionCard[] = []
  for (const card of (data as ActionCard[] | null) ?? []) {
    const { data: won } = await db.from('action_queue')
      .update({ status: 'generating', attempts: card.attempts + 1, updated_at: now() })
      .eq('id', card.id).eq('status', 'queued').select(CARD_COLUMNS).maybeSingle()
    if (won) claimed.push(won as ActionCard)
  }
  return claimed
}

export async function getCard(db: SupabaseClient, tenantId: string, id: string): Promise<ActionCard | null> {
  const { data } = await db.from('action_queue').select(CARD_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  return (data as ActionCard | null) ?? null
}

/** upcoming: follow-ups waiting for their date */
export type CardView = 'pending' | 'upcoming' | 'done'

const VIEW_STATUSES: Record<CardView, CardStatus[]> = {
  pending: ['queued', 'generating', 'pending', 'running', 'failed'],
  upcoming: ['scheduled'],
  done: ['done', 'skipped', 'no_action'],
}

export async function listCards(
  db: SupabaseClient,
  tenantId: string,
  view: CardView,
  { limit = 100, category = null, jobId = null }: { limit?: number; category?: CardCategory | null; jobId?: string | null } = {},
): Promise<ActionCard[]> {
  let q = db.from('action_queue').select(CARD_COLUMNS).eq('tenant_id', tenantId).in('status', VIEW_STATUSES[view])
  if (category) q = q.eq('category', category)
  if (jobId) q = q.eq('job_id', jobId)
  q = view === 'pending'
    ? q.order('priority', { ascending: false }).order('updated_at', { ascending: false })
    : view === 'upcoming'
    ? q.order('due_at', { ascending: true })
    : q.order('updated_at', { ascending: false })
  const { data, error } = await q.limit(limit)
  if (error) throw new Error(error.message)
  return (data as ActionCard[] | null) ?? []
}

/** Pending cards needing the user, for the counts in the rail */
export async function countPending(db: SupabaseClient, tenantId: string): Promise<number> {
  const { count } = await db.from('action_queue').select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).in('status', ['pending', 'failed'])
  return count ?? 0
}

export type RowStar = { id: string; status: CardStatus; title: string; category: CardCategory }

/** Gmail thread → its live card (its star), for the list and the conversation */
export async function cardsForThreads(db: SupabaseClient, tenantId: string, threadIds: string[]): Promise<Record<string, RowStar>> {
  if (!threadIds.length) return {}
  const { data } = await db.from('action_queue').select('id, source_ref, status, title, category')
    .eq('tenant_id', tenantId).eq('source', 'email').in('source_ref', threadIds).in('status', LIVE_STATUSES)
  const out: Record<string, RowStar> = {}
  for (const r of (data as (RowStar & { source_ref: string })[] | null) ?? []) {
    out[r.source_ref] = { id: r.id, status: r.status, title: r.title, category: r.category }
  }
  return out
}

/** Starred conversations (live email cards), optionally one category — the Starred folder */
export async function starredThreadIds(db: SupabaseClient, tenantId: string, category: CardCategory | null = null): Promise<string[]> {
  let q = db.from('action_queue').select('source_ref')
    .eq('tenant_id', tenantId).eq('source', 'email').in('status', LIVE_STATUSES)
  if (category) q = q.eq('category', category)
  const { data, error } = await q.limit(1000)
  if (error) throw new Error(error.message)
  return ((data as { source_ref: string | null }[] | null) ?? []).map(r => r.source_ref).filter((id): id is string => !!id)
}

/**
 * Sets a conversation's star — the inbox's star button. A category stars it
 * (a new card, which the AI then fills in with a summary and steps) or
 * changes its symbol; null takes the star off (the card is done).
 */
export async function starThread(db: SupabaseClient, tenantId: string, threadId: string, category: CardCategory | null, userId: string): Promise<RowStar | null> {
  const live = await liveCard(db, tenantId, threadId)
  if (!category) {
    if (live) {
      await db.from('action_queue')
        .update({ status: 'done', outcome: 'Star taken off', confirmed_by: userId, confirmed_at: now(), updated_at: now() })
        .eq('id', live.id)
    }
    return null
  }
  if (live) {
    await db.from('action_queue').update({ category, starred_by: userId, starred_at: now(), updated_at: now() }).eq('id', live.id)
    return { id: live.id, status: live.status, title: live.title, category }
  }
  const { data: thread } = await db.from('mail_threads').select('subject')
    .eq('tenant_id', tenantId).eq('gmail_thread_id', threadId).maybeSingle()
  const title = (thread as { subject: string | null } | null)?.subject || 'Starred email'
  const { data, error } = await db.from('action_queue').insert({
    tenant_id: tenantId,
    source: 'email',
    source_ref: threadId,
    rule_key: 'email',
    title,
    status: 'queued',
    category,
    starred_by: userId,
    starred_at: now(),
    priority: PRIORITY.normal,
  }).select('id').single()
  if (error) {
    // Starred twice at once, or a card was just queued: star that one
    const again = await liveCard(db, tenantId, threadId)
    if (!again) throw new Error(error.message)
    return starThread(db, tenantId, threadId, category, userId)
  }
  return { id: (data as { id: string }).id, status: 'queued', title, category }
}

/** Changes a card's symbol from the card itself (it then keeps it, as a star the user set) */
export async function setCardCategory(db: SupabaseClient, tenantId: string, id: string, category: CardCategory, userId: string): Promise<boolean> {
  const { data } = await db.from('action_queue')
    .update({ category, starred_by: userId, starred_at: now(), updated_at: now() })
    .eq('tenant_id', tenantId).eq('id', id).in('status', LIVE_STATUSES)
    .select('id').maybeSingle()
  return !!data
}

/** The card for one conversation: the live one, else the newest */
export async function cardForThread(db: SupabaseClient, tenantId: string, threadId: string): Promise<ActionCard | null> {
  const live = await liveCard(db, tenantId, threadId)
  if (live) return live
  const { data } = await db.from('action_queue').select(CARD_COLUMNS)
    .eq('tenant_id', tenantId).eq('source', 'email').eq('source_ref', threadId)
    .order('updated_at', { ascending: false }).limit(1)
  return ((data as ActionCard[] | null) ?? [])[0] ?? null
}

export async function skipCard(db: SupabaseClient, tenantId: string, id: string, userId: string): Promise<boolean> {
  const { data } = await db.from('action_queue')
    .update({ status: 'skipped', outcome: 'Skipped', confirmed_by: userId, confirmed_at: now(), updated_at: now() })
    .eq('tenant_id', tenantId).eq('id', id).in('status', ['pending', 'failed', 'queued'])
    .select(CARD_COLUMNS).maybeSingle()
  if (data) {
    await recordCardDecision(db, data as ActionCard, userId, 'skipped')
    const { recordChaseDecision } = await import('./waits')
    await recordChaseDecision(db, data as ActionCard, userId, 'skipped')
  }
  return !!data
}

const MAX_TITLE = 200
/** Not while it's being written or its steps are running */
const EDITABLE_TEXT: CardStatus[] = ['scheduled', 'queued', 'pending', 'failed', 'done', 'skipped', 'no_action']
const MAX_SUMMARY = 4000

/** A new title or summary for a card — what it says, not its steps. Not while its steps are running. */
export async function updateCardText(
  db: SupabaseClient, tenantId: string, id: string, { title, description }: { title?: string; description?: string | null },
): Promise<ActionCard> {
  const patch: Record<string, unknown> = {}
  if (typeof title === 'string') {
    if (!title.trim()) throw new CardError('A card needs a title')
    patch.title = title.trim().slice(0, MAX_TITLE)
  }
  if (description !== undefined) patch.description = description?.trim().slice(0, MAX_SUMMARY) || null
  if (!Object.keys(patch).length) throw new CardError('Nothing to change')
  const { data } = await db.from('action_queue').update({ ...patch, updated_at: now() })
    .eq('tenant_id', tenantId).eq('id', id).in('status', EDITABLE_TEXT)
    .select(CARD_COLUMNS).maybeSingle()
  if (!data) {
    const card = await getCard(db, tenantId, id)
    throw card ? new CardError(`This card is ${card.status} — try again in a moment`, 409) : new CardError('Card not found', 404)
  }
  return data as ActionCard
}

/** Marks a card done without running its steps: dealt with another way */
export async function markCardDone(db: SupabaseClient, tenantId: string, id: string, userId: string): Promise<boolean> {
  const { data } = await db.from('action_queue')
    .update({ status: 'done', outcome: 'Marked done', confirmed_by: userId, confirmed_at: now(), updated_at: now() })
    .eq('tenant_id', tenantId).eq('id', id).in('status', ['pending', 'failed', 'queued'])
    .select('id').maybeSingle()
  return !!data
}

/**
 * Puts a done, skipped or no-action card back on the to-do list. A
 * conversation has one live card, so not if it already has another.
 */
export async function reopenCard(db: SupabaseClient, tenantId: string, id: string): Promise<ActionCard> {
  const card = await getCard(db, tenantId, id)
  if (!card) throw new CardError('Card not found', 404)
  if (!['done', 'skipped', 'no_action'].includes(card.status)) throw new CardError(`This card is ${card.status} — it's already on the list or on its way`, 409)
  if (card.source === 'email' && card.source_ref && await liveCard(db, tenantId, card.source_ref)) {
    throw new CardError('That conversation already has a card on the list — edit that one instead', 409)
  }
  const { data, error } = await db.from('action_queue')
    .update({ status: 'pending', outcome: null, error_log: null, updated_at: now() })
    .eq('tenant_id', tenantId).eq('id', id).in('status', ['done', 'skipped', 'no_action'])
    .select(CARD_COLUMNS).maybeSingle()
  if (error) throw new CardError('That conversation already has a card on the list — edit that one instead', 409)
  if (!data) throw new CardError('This card just changed — check it again', 409)
  return data as ActionCard
}

/** The conversation a card is about: an email card's own, or the one a follow-up was set from */
export const cardThreadId = (c: Pick<ActionCard, 'source' | 'source_ref' | 'follow_up'>): string | null =>
  c.source === 'email' ? c.source_ref : c.follow_up?.thread_id ?? null

export type CardWithContext = ActionCard & {
  job: { id: string; job_number: string; insured_name: string | null } | null
  conversation: { subject: string | null; from: string | null; last_message_at: string | null; unread: boolean } | null
  /** A follow-up: who it's for, by name */
  follow_up_for: string | null
}

/** Adds the job chip and the conversation (subject, sender) each card is about */
export async function withContext(db: SupabaseClient, tenantId: string, cards: ActionCard[]): Promise<CardWithContext[]> {
  const jobIds = [...new Set(cards.map(c => c.job_id).filter((id): id is string => !!id))]
  const threadIds = [...new Set(cards.map(cardThreadId).filter((id): id is string => !!id))]
  const userIds = [...new Set(cards.map(c => c.follow_up?.created_by).filter((id): id is string => !!id))]
  const [{ data: jobs }, { data: threads }, { data: users }] = await Promise.all([
    jobIds.length ? db.from('jobs').select('id, job_number, insured_name').eq('tenant_id', tenantId).in('id', jobIds) : Promise.resolve({ data: [] }),
    threadIds.length ? db.from('mail_threads').select('gmail_thread_id, subject, participants, last_message_at, unread').eq('tenant_id', tenantId).in('gmail_thread_id', threadIds) : Promise.resolve({ data: [] }),
    userIds.length ? db.from('users').select('id, name').eq('tenant_id', tenantId).in('id', userIds) : Promise.resolve({ data: [] }),
  ])
  const nameById = new Map(((users as { id: string; name: string }[] | null) ?? []).map(u => [u.id, u.name]))
  type ThreadRow = { gmail_thread_id: string; subject: string | null; participants: { name: string; email: string; me: boolean }[]; last_message_at: string | null; unread: boolean }
  const jobById = new Map(((jobs as CardWithContext['job'][] | null) ?? []).map(j => [j!.id, j]))
  const threadById = new Map(((threads as ThreadRow[] | null) ?? []).map(t => [t.gmail_thread_id, t]))
  return cards.map(c => {
    const thread = cardThreadId(c)
    const t = thread ? threadById.get(thread) : undefined
    const sender = t?.participants.filter(p => !p.me).at(-1)
    return {
      ...c,
      job: c.job_id ? jobById.get(c.job_id) ?? null : null,
      conversation: t ? { subject: t.subject, from: sender ? sender.name || sender.email : null, last_message_at: t.last_message_at, unread: t.unread } : null,
      follow_up_for: c.follow_up?.created_by ? nameById.get(c.follow_up.created_by) ?? null : null,
    }
  })
}
