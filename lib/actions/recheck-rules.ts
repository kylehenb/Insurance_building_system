import type { SupabaseClient } from '@supabase/supabase-js'
import { recordLearning } from '@/lib/learning/events'
import { cardThreadId, type ActionCard } from './cards'
import { situationText } from './learning'

// Out-of-date cards (tech spec §23.17): what's happened on a card's job since
// it was written, and what it weighs for the card — the free part, which the
// card list, confirming and the check (lib/actions/recheck.ts) share. Kept
// apart from the check itself (the AI and the job file), which is server only.

/** The learning module's name for it (tech spec §24) */
export const FEATURE = 'card_recheck'
/** Its AI calls, for the health check (lib/health/ai-costs.ts) */
export const AI_FEATURE = 'card-recheck'

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

export const perth = (iso: string) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

/** One line for a change: "Mon 6 Nov, 2:14 pm — Kyle: Sent the BAR to Castle" */
export function changeLine(c: JobChange): string {
  const what = c.kind === 'note' ? `Job note: ${c.summary}`
    : c.kind === 'email_in' ? `Email in: ${c.summary}`
    : c.kind === 'email_out' ? `Email sent: ${c.summary}`
    : c.kind === 'portal' ? `Insurer portal: ${c.summary}`
    : c.summary
  return `${perth(c.at)}${c.who ? ` — ${c.who}` : ''}: ${what}`
}

export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

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
