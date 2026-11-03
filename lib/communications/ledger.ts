import type { SupabaseClient } from '@supabase/supabase-js'

// The job ledger (tech spec §23.16): everything that happened on a job, in one
// place — the Comms feed. Emails in and out and job notes are communications
// rows; everything else that happens on the job — what people do (sends,
// quotes, stage changes, invoices, follow-ups, approvals: the who-did-what
// log, lib/activity/log.ts) and what happens by itself (a phase change, an
// invoice paid in the accounts: recordSystemEvent) — comes from activity_log.
// Nothing has to be filed or noted by hand for it to be here. The feed
// (GET /api/communications), get_job_summary and get_job_history all read it.

/** Logged actions whose record is already in the feed itself (the email, the note) */
const IN_THE_FEED = new Set(['jobs.notes', 'mail.send', 'send.replies'])

const VIA: Record<string, string> = { voice: 'by voice', approval: 'on approval' }

export type JobEvent = {
  id: string
  at: string
  /** Who did it — a name — or null when it happened by itself */
  who: string | null
  automatic: boolean
  /** "by voice", "on approval", or null */
  how: string | null
  action: string
  summary: string
  outcome: string
  detail: string | null
}

type ActivityRow = { id: string; created_at: string; user_id: string | null; action: string; summary: string; via: string; outcome: string; detail: string | null }

/** The job's logged events (not its emails and notes), oldest first */
export async function jobEvents(db: SupabaseClient, tenantId: string, jobId: string, limit = 500): Promise<JobEvent[]> {
  const { data, error } = await db.from('activity_log')
    .select('id, created_at, user_id, action, summary, via, outcome, detail')
    .eq('tenant_id', tenantId).eq('job_id', jobId)
    .order('created_at', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  const rows = ((data as ActivityRow[] | null) ?? []).filter(r => !IN_THE_FEED.has(r.action))
  const userIds = [...new Set(rows.map(r => r.user_id).filter((id): id is string => !!id))]
  const { data: users } = userIds.length
    ? await db.from('users').select('id, name').eq('tenant_id', tenantId).in('id', userIds)
    : { data: [] }
  const names = new Map(((users as { id: string; name: string | null }[] | null) ?? []).map(u => [u.id, u.name]))
  return rows.map(r => ({
    id: r.id,
    at: r.created_at,
    who: r.via === 'system' ? null : (r.user_id ? names.get(r.user_id) ?? null : null),
    automatic: r.via === 'system',
    how: VIA[r.via] ?? null,
    action: r.action,
    summary: r.summary,
    outcome: r.outcome,
    detail: r.detail,
  })).reverse()
}

const OUTCOME: Record<string, string> = { failed: 'Failed: ', requested: 'Asked for approval: ', rejected: 'Not approved: ', cancelled: 'Cancelled: ' }

/** One event as a line of text: "Moved to In repair…", "Failed: Send email…" */
export const eventText = (e: Pick<JobEvent, 'summary' | 'outcome'>) => `${OUTCOME[e.outcome] ?? ''}${e.summary}`

/** Who, for the feed and the AI: "IRC (automatic)", "Kyle (by voice)" */
export const eventWho = (e: Pick<JobEvent, 'who' | 'automatic' | 'how'>) =>
  e.automatic ? 'IRC (automatic)' : `${e.who ?? 'Someone'}${e.how ? ` (${e.how})` : ''}`

/** An event in the shape of a Comms feed row (type 'system'), read-only */
export function eventAsComm(e: JobEvent) {
  return {
    id: `event:${e.id}`,
    type: 'system',
    direction: null,
    contact_type: null,
    contact_name: eventWho(e),
    contact_detail: null,
    subject: null,
    content: eventText(e),
    body_text: e.detail,
    attachments: null,
    requires_action: false,
    action_queue_id: null,
    created_at: e.at,
    from_email: null,
    to_email: null,
    gmail_message_id: null,
    thread_id: null,
    work_order_id: null,
    persona: null,
    source: e.automatic ? 'system_event' : 'activity',
    read_at: e.at,
    is_starred: false,
  }
}

/** Ids of ledger rows that aren't communications (and can't be starred or marked read) */
export const isEventId = (id: string) => id.startsWith('event:')

type CommRow = { id: string; type: string; direction: string | null; contact_name: string | null; subject: string | null; content: string | null; body_text: string | null; from_email: string | null; to_email: string | null; created_at: string | null }

export type LedgerLine = { at: string; kind: 'email' | 'note' | 'event' | 'other'; text: string }

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const oneLine = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

/** The whole ledger as lines, newest first: emails, notes and events */
export async function jobLedger(db: SupabaseClient, tenantId: string, jobId: string, opts: { limit?: number; kinds?: LedgerLine['kind'][] } = {}): Promise<LedgerLine[]> {
  const limit = opts.limit ?? 30
  const [{ data, error }, events] = await Promise.all([
    db.from('communications')
      .select('id, type, direction, contact_name, subject, content, body_text, from_email, to_email, created_at')
      .eq('tenant_id', tenantId).eq('job_id', jobId)
      .order('created_at', { ascending: false }).limit(limit * 2),
    jobEvents(db, tenantId, jobId, limit * 2),
  ])
  if (error) throw new Error(error.message)
  const lines: LedgerLine[] = []
  for (const c of (data as CommRow[] | null) ?? []) {
    if (!c.created_at) continue
    if (c.type === 'email') {
      const dir = c.direction === 'outbound' ? `Sent to ${c.to_email ?? c.contact_name ?? 'someone'}` : `From ${c.contact_name || c.from_email || 'someone'}`
      const gist = clip(oneLine(c.body_text || c.content), 160)
      lines.push({ at: c.created_at, kind: 'email', text: `Email — ${dir}: "${oneLine(c.subject) || '(no subject)'}"${gist ? ` — ${gist}` : ''}` })
    } else if (c.type === 'note') {
      lines.push({ at: c.created_at, kind: 'note', text: `Note${c.contact_name ? ` by ${c.contact_name}` : ''}: ${clip(oneLine(c.content), 400)}` })
    } else {
      lines.push({ at: c.created_at, kind: 'other', text: clip(oneLine(c.content || c.subject), 200) || c.type })
    }
  }
  for (const e of events) lines.push({ at: e.at, kind: 'event', text: `${eventWho(e)}: ${clip(eventText(e), 300)}` })
  return lines
    .filter(l => !opts.kinds || opts.kinds.includes(l.kind))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit)
}
