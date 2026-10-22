import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExtractedMessage, MessageAttachment } from '@/lib/gmail/messages'
import { resolveCommunicationLink, type CommunicationLink } from '@/lib/communications/resolve-link'
import { linkThreadToJob } from '@/lib/communications/thread-link'

// Recording an inbound email on the comms log: its attachments go to storage
// and it's linked to a job via thread → content match → unlinked/admin. Used
// by the Gmail webhook (app/api/webhooks/email-inbound) and the voice
// connector's save_email.

// Extensions that are never stored regardless of MIME type
const BLOCKED_EXTENSIONS = new Set(['.exe', '.bat', '.scr', '.js', '.jar', '.msi', '.cmd'])
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024 // 50 MB — matches job-files convention

export type StoredAttachment = {
  filename: string
  storage_path: string
  mime_type: string
  size_bytes: number
}

function sanitizeAttachmentName(filename: string): string {
  return filename.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._\-]/g, '_')
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot).toLowerCase() : ''
}

export async function uploadAttachments(
  attachments: MessageAttachment[],
  tenantId: string,
  communicationId: string,
  db: SupabaseClient,
  msgId: string
): Promise<StoredAttachment[]> {
  const stored: StoredAttachment[] = []

  for (const att of attachments) {
    const ext = getExtension(att.filename)

    if (BLOCKED_EXTENSIONS.has(ext)) {
      console.warn(
        `[inbound-email] BLOCKED executable attachment "${att.filename}" ext="${ext}" (msgId=${msgId}) — skipping`
      )
      continue
    }

    if (att.size > MAX_ATTACHMENT_BYTES) {
      console.warn(
        `[inbound-email] OVERSIZED attachment "${att.filename}" (${att.size}B > 50MB limit, msgId=${msgId}) — skipping`
      )
      continue
    }

    if (!att.data) {
      console.warn(
        `[inbound-email] attachment "${att.filename}" has no data (msgId=${msgId}) — skipping`
      )
      continue
    }

    const sanitized = sanitizeAttachmentName(att.filename)
    const storagePath = `tenants/${tenantId}/comms/${communicationId}/${Date.now()}-${sanitized}`

    try {
      const bytes = Buffer.from(att.data, 'base64')
      const { error: uploadErr } = await db.storage
        .from('job-files')
        .upload(storagePath, bytes, { contentType: att.mimeType })

      if (uploadErr) {
        console.error(
          `[inbound-email] Storage upload FAILED for "${att.filename}" (msgId=${msgId}):`,
          uploadErr
        )
        continue
      }

      stored.push({
        filename: att.filename,
        storage_path: storagePath,
        mime_type: att.mimeType,
        size_bytes: att.size,
      })
    } catch (err) {
      console.error(
        `[inbound-email] unexpected upload error for "${att.filename}" (msgId=${msgId}):`,
        err
      )
    }
  }

  return stored
}

/**
 * Inserts an inbound (non-order) email as a communication, resolving its job
 * via thread → content match → unlinked/admin. When content matching links it,
 * earlier unlinked messages in the same thread are linked too.
 */
export async function insertLinkedCommunication(
  db: SupabaseClient,
  tenantId: string,
  communicationId: string,
  msg: ExtractedMessage,
  storedAttachments: StoredAttachment[],
): Promise<CommunicationLink | null> {
  const link = await resolveCommunicationLink({
    db,
    tenantId,
    threadId: msg.threadId || null,
    subject: msg.subject,
    body: msg.bodyText,
    fromEmail: msg.fromEmail,
  })

  const { error } = await db.from('communications').insert({
    id: communicationId,
    tenant_id: tenantId,
    job_id: link.job_id,
    type: 'email',
    direction: 'inbound',
    subject: msg.subject,
    content: msg.bodyText,
    created_at: msg.receivedAt,
    thread_id: msg.threadId,
    from_email: msg.fromEmail,
    to_email: msg.to,
    body_text: msg.bodyText,
    gmail_message_id: msg.gmailMessageId || null,
    source: link.source,
    match_candidates: link.match_candidates,
    attachments: storedAttachments,
  })
  if (error) {
    console.error(`[inbound-email] communications insert failed for ${msg.messageId}:`, error)
    return null
  }

  if (link.job_id && link.source === 'auto_linked') {
    await linkThreadToJob(db, tenantId, msg.threadId, link.job_id)
  }
  return link
}
