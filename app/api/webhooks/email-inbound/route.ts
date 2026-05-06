/**
 * Google Cloud Pub/Sub push endpoint for inbound Gmail messages.
 *
 * Manual setup required after deployment:
 *
 * 1. Create Pub/Sub topic: gmail-inbound in project irc-master
 *    gcloud pubsub topics create gmail-inbound --project=irc-master
 *
 * 2. Create push subscription pointing to this endpoint:
 *    gcloud pubsub subscriptions create gmail-inbound-push \
 *      --topic=gmail-inbound \
 *      --push-endpoint="https://insurance-building-system.vercel.app/api/webhooks/email-inbound?token=<GMAIL_WEBHOOK_SECRET>" \
 *      --project=irc-master
 *
 * 3. Grant Gmail service account publish rights on the topic:
 *    gcloud pubsub topics add-iam-policy-binding gmail-inbound \
 *      --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
 *      --role="roles/pubsub.publisher" \
 *      --project=irc-master
 *
 * 4. Call POST /api/gmail/setup once to register the Gmail watch and seed historyId.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { getGmailClient } from '@/lib/gmail/client'
import { getFullMessage, extractMessageParts } from '@/lib/gmail/messages'
import { parseInsurerOrder } from '@/lib/email/order-parser'
import { writeInsurerOrder } from '@/lib/email/order-writer'
import { sendOrderNotification } from '@/lib/email/order-notifier'

const OUR_DOMAIN = 'insurancerepairco.com.au'

const ORDER_KEYWORDS = [
  'claim', 'loss', 'repair order', 'works order',
  'new instruction', 'new matter',
]

const KNOWN_INSURER_DOMAINS = ['castle', 'sedgwick']

function isOwnDomain(email: string): boolean {
  return email.toLowerCase().endsWith(`@${OUR_DOMAIN}`)
}

function isOrderEmail(fromEmail: string, subject: string): boolean {
  const domainPart = fromEmail.split('@')[1]?.toLowerCase() ?? ''
  if (KNOWN_INSURER_DOMAINS.some(d => domainPart.includes(d))) return true
  const subjectLower = subject.toLowerCase()
  return ORDER_KEYWORDS.some(kw => subjectLower.includes(kw))
}

type PubSubMessage = {
  data: string
  messageId: string
  publishTime: string
}

type PubSubBody = {
  message: PubSubMessage
  subscription: string
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Verify token before doing anything
  const token = req.nextUrl.searchParams.get('token')
  if (token !== process.env.GMAIL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Always return 200 — Pub/Sub retries on anything else
  try {
    const body = await req.json() as PubSubBody
    processWebhook(body).catch(err => {
      console.error('[email-inbound] unhandled processing error:', err)
    })
  } catch (err) {
    console.error('[email-inbound] failed to parse pub/sub body:', err)
  }

  return NextResponse.json({ ok: true })
}

async function processWebhook(body: PubSubBody): Promise<void> {
  const supabase = createServiceClient()
  const rawDb = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const gmail = getGmailClient()

  // Decode Pub/Sub message
  let notification: { emailAddress: string; historyId: string }
  try {
    const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8')
    notification = JSON.parse(decoded) as { emailAddress: string; historyId: string }
  } catch (err) {
    console.error('[email-inbound] failed to decode pub/sub message:', err)
    return
  }

  const { emailAddress, historyId: newHistoryId } = notification

  // Look up tenant from email address
  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('id')
    .eq('contact_email', emailAddress)
    .single()

  // Fall back: use the only tenant (IRC single-tenant for now)
  let tenantId: string
  if (tenantRow) {
    tenantId = tenantRow.id
  } else {
    const { data: firstTenant } = await supabase
      .from('tenants')
      .select('id')
      .limit(1)
      .single()
    if (!firstTenant) {
      console.error('[email-inbound] no tenant found')
      return
    }
    tenantId = firstTenant.id
  }

  // Get last known historyId — use untyped client for new table not yet in DB types
  const { data: syncState } = await rawDb
    .from('gmail_sync_state')
    .select('last_history_id')
    .eq('tenant_id', tenantId)
    .eq('email_address', emailAddress)
    .single()

  const startHistoryId = (syncState as { last_history_id: string } | null)?.last_history_id ?? newHistoryId

  // Fetch history since last known id
  let messageIds: string[] = []
  try {
    const histRes = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded'],
      labelId: 'INBOX',
    })

    for (const record of histRes.data.history ?? []) {
      for (const added of record.messagesAdded ?? []) {
        if (added.message?.id) {
          messageIds.push(added.message.id)
        }
      }
    }
  } catch (err) {
    console.error('[email-inbound] history.list error:', err)
    return
  }

  // Process each new message
  for (const msgId of messageIds) {
    try {
      // Deduplicate — atomically claim this message_id; skip if already processed
      const { count: claimedCount } = await rawDb
        .from('processed_gmail_messages')
        .upsert(
          { message_id: msgId, processed_at: new Date().toISOString() },
          { onConflict: 'message_id', ignoreDuplicates: true, count: 'exact' }
        )
      if (claimedCount === 0) {
        console.log(`[email-inbound] skipping duplicate message ${msgId}`)
        continue
      }

      const raw = await getFullMessage(msgId)
      const msg = extractMessageParts(raw)

      if (isOwnDomain(msg.fromEmail)) continue

      // Check if thread already exists in communications
      if (msg.threadId) {
        const { data: existingThread } = await supabase
          .from('communications')
          .select('id, job_id')
          .eq('tenant_id', tenantId)
          // thread_id column added via migration; use type cast
          .eq('thread_id' as never, msg.threadId as never)
          .limit(1)
          .single()

        if (existingThread) {
          // Append to existing thread
          await supabase.from('communications').insert({
            tenant_id: tenantId,
            job_id: existingThread.job_id,
            type: 'email',
            direction: 'inbound',
            subject: msg.subject,
            content: msg.bodyText,
            created_at: msg.receivedAt,
            thread_id: msg.threadId,
            from_email: msg.fromEmail,
            to_email: msg.to,
            body_text: msg.bodyText,
            source: 'inbound',
          } as never)
          continue
        }
      }

      if (isOrderEmail(msg.fromEmail, msg.subject)) {
        let orderId: string | null = null
        try {
          const parsed = await parseInsurerOrder(msg)
          orderId = await writeInsurerOrder(parsed, msg, tenantId)
          await sendOrderNotification(orderId, parsed, msg)
        } catch (err) {
          console.error(`[email-inbound] order pipeline error for ${msgId}:`, err)
          if (!orderId) {
            const { error: fbErr } = await supabase.from('insurer_orders').insert({
              tenant_id: tenantId,
              parse_status: 'needs_review',
              entry_method: 'email',
              order_sender_email: msg.fromEmail || null,
              order_sender_name: msg.fromName || null,
              notes: msg.subject || null,
              raw_email_link: `https://mail.google.com/mail/u/0/#inbox/${msgId}`,
              status: 'pending',
            })
            if (fbErr) {
              console.error(`[email-inbound] fallback order insert failed for ${msgId}:`, fbErr)
            }
          }
        }
      } else {
        // Unmatched — write to communications with job_id: null
        await supabase.from('communications').insert({
          tenant_id: tenantId,
          job_id: null,
          type: 'email',
          direction: 'inbound',
          subject: msg.subject,
          content: msg.bodyText,
          created_at: msg.receivedAt,
          thread_id: msg.threadId,
          from_email: msg.fromEmail,
          to_email: msg.to,
          body_text: msg.bodyText,
          source: 'unlinked',
        } as never)
      }
    } catch (err) {
      console.error(`[email-inbound] error processing message ${msgId}:`, err)
    }
  }

  // Update last processed historyId — use untyped client for new table
  await rawDb.from('gmail_sync_state').upsert(
    {
      tenant_id: tenantId,
      email_address: emailAddress,
      last_history_id: newHistoryId,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id,email_address' }
  )
}
