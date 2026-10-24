import type { SupabaseClient } from '@supabase/supabase-js'
import type { Arrivals } from '@/lib/mail/summary'

// Action cards (tech spec §19, §23.11): the AI's suggested next steps,
// stored in action_queue. This file is the card lifecycle — queueing a card
// when an email arrives, claiming queued cards for generation
// (lib/actions/propose.ts), skip / snooze, and reading them for the page.
// Confirming runs the steps (lib/actions/confirm.ts).

export type StepKind = 'email' | 'filing' | 'change'
export type StepStatus = 'done' | 'failed' | 'waiting' | 'skipped'

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
}

export type CardStatus = 'queued' | 'generating' | 'pending' | 'running' | 'snoozed' | 'done' | 'skipped' | 'no_action' | 'failed'

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
  priority: number | null
  snoozed_until: string | null
  outcome: string | null
  error_log: string | null
  attempts: number
  created_at: string
  updated_at: string
}

/** Cards that can still change: one per conversation (see the unique index) */
export const LIVE_STATUSES: CardStatus[] = ['queued', 'generating', 'pending', 'snoozed', 'failed']

export const CARD_COLUMNS = 'id, tenant_id, job_id, source, source_ref, trigger_ref, title, description, reasoning, steps, status, priority, snoozed_until, outcome, error_log, attempts, created_at, updated_at'

/** Priority from the model's high / normal / low */
export const PRIORITY = { high: 90, normal: 50, low: 20 } as const

const MAX_ATTEMPTS = 3
const STUCK_MS = 10 * 60_000

const now = () => new Date().toISOString()

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
      .update({ status: 'queued', trigger_ref: messageId ?? live.trigger_ref, attempts: 0, error_log: null, snoozed_until: null, updated_at: now() })
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
 * card; a send from us in a conversation means it's been dealt with.
 */
export async function onMailArrivals(db: SupabaseClient, tenantId: string, arrivals: Arrivals | undefined): Promise<number> {
  if (!arrivals) return 0
  const replied = new Set(arrivals.sentThreadIds)
  let queued = 0
  // Only the newest email per conversation matters
  const newest = new Map<string, string>()
  for (const r of arrivals.received) newest.set(r.threadId, r.messageId)
  for (const [threadId, messageId] of newest) {
    if (replied.has(threadId)) continue
    if (await queueEmailCard(db, tenantId, threadId, messageId)) queued++
  }
  if (replied.size) {
    await db.from('action_queue')
      .update({ status: 'done', outcome: 'Replied from Mail', updated_at: now() })
      .eq('tenant_id', tenantId).eq('source', 'email').in('source_ref', [...replied])
      .in('status', ['queued', 'pending', 'snoozed', 'failed'])
  }
  return queued
}

/**
 * Takes up to `limit` queued cards for generation (status → generating, so
 * overlapping runs don't both make one). Also brings back snoozed cards that
 * are due, and re-queues generation that was cut off.
 */
export async function claimQueued(db: SupabaseClient, limit: number): Promise<ActionCard[]> {
  const t = now()
  await db.from('action_queue').update({ status: 'pending', snoozed_until: null, updated_at: t })
    .eq('status', 'snoozed').lte('snoozed_until', t)
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

export type CardView = 'pending' | 'snoozed' | 'done'

const VIEW_STATUSES: Record<CardView, CardStatus[]> = {
  pending: ['queued', 'generating', 'pending', 'running', 'failed'],
  snoozed: ['snoozed'],
  done: ['done', 'skipped', 'no_action'],
}

export async function listCards(db: SupabaseClient, tenantId: string, view: CardView, limit = 100): Promise<ActionCard[]> {
  let q = db.from('action_queue').select(CARD_COLUMNS).eq('tenant_id', tenantId).in('status', VIEW_STATUSES[view])
  q = view === 'pending'
    ? q.order('priority', { ascending: false }).order('updated_at', { ascending: false })
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

/** Gmail thread → its live card, for list chips and the conversation panel */
export async function cardsForThreads(db: SupabaseClient, tenantId: string, threadIds: string[]): Promise<Record<string, { id: string; status: CardStatus; title: string }>> {
  if (!threadIds.length) return {}
  const { data } = await db.from('action_queue').select('id, source_ref, status, title')
    .eq('tenant_id', tenantId).eq('source', 'email').in('source_ref', threadIds).in('status', LIVE_STATUSES)
  const out: Record<string, { id: string; status: CardStatus; title: string }> = {}
  for (const r of (data as { id: string; source_ref: string; status: CardStatus; title: string }[] | null) ?? []) {
    out[r.source_ref] = { id: r.id, status: r.status, title: r.title }
  }
  return out
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
    .eq('tenant_id', tenantId).eq('id', id).in('status', ['pending', 'failed', 'snoozed', 'queued'])
    .select('id').maybeSingle()
  return !!data
}

export async function snoozeCard(db: SupabaseClient, tenantId: string, id: string, until: string): Promise<boolean> {
  const { data } = await db.from('action_queue')
    .update({ status: 'snoozed', snoozed_until: until, updated_at: now() })
    .eq('tenant_id', tenantId).eq('id', id).in('status', ['pending', 'failed'])
    .select('id').maybeSingle()
  return !!data
}

export type CardWithContext = ActionCard & {
  job: { id: string; job_number: string; insured_name: string | null } | null
  conversation: { subject: string | null; from: string | null; last_message_at: string | null; unread: boolean } | null
}

/** Adds the job chip and the conversation (subject, sender) each card is about */
export async function withContext(db: SupabaseClient, tenantId: string, cards: ActionCard[]): Promise<CardWithContext[]> {
  const jobIds = [...new Set(cards.map(c => c.job_id).filter((id): id is string => !!id))]
  const threadIds = [...new Set(cards.filter(c => c.source === 'email' && c.source_ref).map(c => c.source_ref!))]
  const [{ data: jobs }, { data: threads }] = await Promise.all([
    jobIds.length ? db.from('jobs').select('id, job_number, insured_name').eq('tenant_id', tenantId).in('id', jobIds) : Promise.resolve({ data: [] }),
    threadIds.length ? db.from('mail_threads').select('gmail_thread_id, subject, participants, last_message_at, unread').eq('tenant_id', tenantId).in('gmail_thread_id', threadIds) : Promise.resolve({ data: [] }),
  ])
  type ThreadRow = { gmail_thread_id: string; subject: string | null; participants: { name: string; email: string; me: boolean }[]; last_message_at: string | null; unread: boolean }
  const jobById = new Map(((jobs as CardWithContext['job'][] | null) ?? []).map(j => [j!.id, j]))
  const threadById = new Map(((threads as ThreadRow[] | null) ?? []).map(t => [t.gmail_thread_id, t]))
  return cards.map(c => {
    const t = c.source_ref ? threadById.get(c.source_ref) : undefined
    const sender = t?.participants.filter(p => !p.me).at(-1)
    return {
      ...c,
      job: c.job_id ? jobById.get(c.job_id) ?? null : null,
      conversation: t ? { subject: t.subject, from: sender ? sender.name || sender.email : null, last_message_at: t.last_message_at, unread: t.unread } : null,
    }
  })
}
