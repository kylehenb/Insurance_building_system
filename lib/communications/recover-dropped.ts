import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getGmailClient } from '@/lib/gmail/client'
import { extractMessageParts, getFullMessage } from '@/lib/gmail/messages'
import { insertLinkedCommunication, uploadAttachments } from '@/lib/communications/inbound-email'

// One-off recovery: before 23 Oct 2026 an email that matched an order rule
// but wasn't a new order (remittance advice, a reply on an authorised job…)
// was dropped — no order, no comms record. Each one left an ai_audit row
// (prompt_key 'email_order_parser', outcome 'rejected') with its subject,
// sender and time but no Gmail id, so the email is found again in Gmail by
// sender, date and exact subject, then saved and linked to its job like any
// other inbound email. Safe to re-run: emails already on the comms log are
// skipped.

const OWN_DOMAIN = 'insurancerepairco.com.au'
/** Gmail search window around the audit time (the email arrives just before it's classified) */
const SEARCH_DAYS_BEFORE = 3
const SEARCH_DAYS_AFTER = 1
const DAY_MS = 24 * 60 * 60 * 1000

export interface DroppedEmail {
  auditId: string
  /** When it was classified (≈ received) */
  at: string
  subject: string
  from: string
}

export type RecoveryStatus = 'saved' | 'would_save' | 'already_saved' | 'not_found' | 'error'

export interface RecoveryResult extends DroppedEmail {
  status: RecoveryStatus
  jobId?: string | null
  detail?: string
}

interface AuditRow { id: string; created_at: string; input_summary: string | null }

/** 'Email: "<subject>" from <address>' — as order-writer.ts writes it */
export function parseAuditSummary(summary: string | null): { subject: string; from: string } | null {
  const m = (summary ?? '').match(/^Email: "([\s\S]*)" from (\S+)$/)
  return m ? { subject: m[1], from: m[2] } : null
}

const normalise = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Dropped emails after the cursor (an audit created_at), oldest first.
 * lastAt is the next cursor: the last audit row read, kept or not.
 */
export async function listDroppedEmails(db: SupabaseClient, tenantId: string, after: string | null, limit: number): Promise<{ emails: DroppedEmail[]; remaining: number; lastAt: string | null }> {
  let q = db.from('ai_audit')
    .select('id, created_at, input_summary', { count: 'exact' })
    .eq('tenant_id', tenantId).eq('prompt_key', 'email_order_parser').eq('outcome', 'rejected')
  if (after) q = q.gt('created_at', after)
  const { data, error, count } = await q.order('created_at', { ascending: true }).limit(limit)
  if (error) throw error
  const rows = (data ?? []) as AuditRow[]
  const emails = rows.flatMap(r => {
    const parsed = parseAuditSummary(r.input_summary)
    return parsed && !parsed.from.toLowerCase().endsWith(`@${OWN_DOMAIN}`)
      ? [{ auditId: r.id, at: r.created_at, ...parsed }]
      : []
  })
  return { emails, remaining: Math.max(0, (count ?? 0) - rows.length), lastAt: rows.at(-1)?.created_at ?? null }
}

interface Candidate { id: string; rfcId: string; gap: number }

/**
 * Gmail emails matching the dropped one — same sender, same subject, near the
 * time — closest first. Replies in one conversation often share a subject, so
 * there can be several; each is told apart by its Message-ID.
 */
async function findInGmail(email: DroppedEmail): Promise<Candidate[]> {
  const at = new Date(email.at).getTime()
  const after = Math.floor((at - SEARCH_DAYS_BEFORE * DAY_MS) / 1000)
  const before = Math.ceil((at + SEARCH_DAYS_AFTER * DAY_MS) / 1000)
  const gmail = getGmailClient()
  const list = await gmail.users.messages.list({ userId: 'me', q: `from:${email.from} after:${after} before:${before}`, maxResults: 50 })
  const found: Candidate[] = []
  for (const m of list.data.messages ?? []) {
    if (!m.id) continue
    const meta = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['Subject', 'Message-ID'] })
    const header = (name: string) => meta.data.payload?.headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''
    if (normalise(header('Subject')) !== normalise(email.subject)) continue
    found.push({ id: m.id, rfcId: header('Message-ID'), gap: Math.abs(Number(meta.data.internalDate ?? 0) - at) })
  }
  return found.sort((a, b) => a.gap - b.gap)
}

/** Finds one dropped email in Gmail and (unless dryRun) saves it to the comms log, linked to its job. */
export async function recoverDroppedEmail(db: SupabaseClient, tenantId: string, email: DroppedEmail, dryRun: boolean): Promise<RecoveryResult> {
  try {
    const candidates = await findInGmail(email)
    if (!candidates.length) return { ...email, status: 'not_found', detail: 'not in Gmail (deleted, or the subject changed)' }

    // The closest match the comms log doesn't have yet. A repeat audit row for
    // the same email (classified twice) finds it already saved.
    let messageId: string | null = null
    let savedJobId: string | null = null
    for (const c of candidates) {
      const { data: known } = c.rfcId
        ? await db.from('communications').select('id, job_id').eq('tenant_id', tenantId).eq('gmail_message_id', c.rfcId).limit(1)
        : { data: [] as { id: string; job_id: string | null }[] }
      if (known?.length) { savedJobId ??= known[0].job_id; continue }
      messageId = c.id
      break
    }
    if (!messageId) return { ...email, status: 'already_saved', jobId: savedJobId }

    if (dryRun) return { ...email, status: 'would_save' }

    const msg = await extractMessageParts(await getFullMessage(messageId))

    const communicationId = randomUUID()
    const stored = msg.attachments.length ? await uploadAttachments(msg.attachments, tenantId, communicationId, db, messageId) : []
    const link = await insertLinkedCommunication(db, tenantId, communicationId, msg, stored)
    if (!link) return { ...email, status: 'error', detail: 'could not be saved' }
    return { ...email, status: 'saved', jobId: link.job_id }
  } catch (err) {
    console.error(`[recover-dropped] ${email.auditId} failed:`, err)
    return { ...email, status: 'error', detail: err instanceof Error ? err.message : String(err) }
  }
}
