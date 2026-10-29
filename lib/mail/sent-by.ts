import type { SupabaseClient } from '@supabase/supabase-js'

// Who in the office sent an email (tech spec §23.12). The office shares one
// mailbox, so Gmail can't say: an email sent from IRC is recorded here as it
// goes, and the mailbox sync adds every other send (from Gmail itself, or an
// automation) without anyone. Each row is also a sent email waiting to be
// read for what it asks of someone (lib/actions/waiting-on.ts).

/** Records an email the office just sent, and who sent it. Never throws: the email has gone either way */
export async function recordSent(db: SupabaseClient, tenantId: string, messageId: string | null | undefined, threadId: string | null | undefined, sentBy: string | null): Promise<void> {
  if (!messageId) return
  try {
    const { error } = await db.from('sent_emails').insert({ tenant_id: tenantId, gmail_message_id: messageId, thread_id: threadId ?? null, sent_by: sentBy })
    // The mailbox sync saw it first: say who sent it
    if (error && sentBy) {
      await db.from('sent_emails').update({ sent_by: sentBy }).eq('tenant_id', tenantId).eq('gmail_message_id', messageId)
    }
  } catch (err) {
    console.error('[sent-by] not recorded:', err)
  }
}

/** Sends the mailbox sync saw, from IRC or Gmail: ones already recorded stay as they are */
export async function recordSyncedSends(db: SupabaseClient, tenantId: string, sent: { messageId: string; threadId: string }[]): Promise<void> {
  if (!sent.length) return
  try {
    const { data } = await db.from('sent_emails').select('gmail_message_id')
      .eq('tenant_id', tenantId).in('gmail_message_id', sent.map(s => s.messageId))
    const known = new Set(((data as { gmail_message_id: string }[] | null) ?? []).map(r => r.gmail_message_id))
    for (const s of sent) {
      if (known.has(s.messageId)) continue
      // A clash is a send recorded at the same moment: that one stands
      await db.from('sent_emails').insert({ tenant_id: tenantId, gmail_message_id: s.messageId, thread_id: s.threadId })
    }
  } catch (err) {
    console.error('[sent-by] synced sends not recorded:', err)
  }
}
