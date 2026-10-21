import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { getGmailClient } from '@/lib/gmail/client'
import { buildEmailRaw, type EmailAttachment } from '@/lib/email/build-raw'

// Sends through the existing Gmail API sender (office@ mailbox), the same
// way Send & Lock does, and marks the sent message as processed so the
// Gmail SENT watch doesn't record it a second time.

export interface OutgoingEmail {
  from: string
  to: string
  bcc?: string
  subject: string
  text: string
  html?: string
  attachments?: EmailAttachment[]
}

export interface SentEmail {
  gmailId: string | null
  threadId: string | null
}

export async function sendEmailViaGmail(service: SupabaseClient<Database>, email: OutgoingEmail): Promise<SentEmail> {
  const raw = buildEmailRaw({
    from: email.from,
    to: email.to,
    bcc: email.bcc,
    subject: email.subject,
    body: email.text,
    html: email.html,
    attachments: email.attachments,
  })
  const res = await getGmailClient().users.messages.send({ userId: 'me', requestBody: { raw } })
  const gmailId = res.data.id ?? null

  if (gmailId) {
    await service
      .from('processed_gmail_messages' as never)
      .upsert(
        { message_id: gmailId, processed_at: new Date().toISOString() } as never,
        { onConflict: 'message_id', ignoreDuplicates: true },
      )
  }
  return { gmailId, threadId: res.data.threadId ?? null }
}

/** Basic address check (same rule as work order emails). */
export function isValidEmail(value: string | null | undefined): value is string {
  return !!value && /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(value.trim())
}
