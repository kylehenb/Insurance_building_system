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

import { NextRequest, NextResponse, after } from 'next/server'
import { randomUUID } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getGmailClient } from '@/lib/gmail/client'
import { getFullMessage, extractMessageParts, type MessageAttachment } from '@/lib/gmail/messages'
import { parseInsurerOrder } from '@/lib/email/order-parser'
import type { ClientEmailConfig } from '@/lib/email/order-parser'
import { writeInsurerOrder } from '@/lib/email/order-writer'
import { sendOrderNotification } from '@/lib/email/order-notifier'
import { matchJob } from '@/lib/communications/match-job'

export const maxDuration = 300

const OUR_DOMAIN = 'insurancerepairco.com.au'

// Extensions that are never stored regardless of MIME type
const BLOCKED_EXTENSIONS = new Set(['.exe', '.bat', '.scr', '.js', '.jar', '.msi', '.cmd'])
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024 // 50 MB — matches job-files convention

type StoredAttachment = {
  filename: string
  storage_path: string
  mime_type: string
  size_bytes: number
}

type SenderPattern = {
  type: 'domain' | 'email' | 'display_name'
  value: string
  active: boolean
}

type ClientEmailConfigRow = {
  id: string
  tenant_id: string
  client_id: string
  sender_patterns: SenderPattern[]
  insurer_hint: string | null
  custom_parsing_notes: string | null
  default_work_order_type: string | null
  active: boolean
  created_at: string
  updated_at: string
}

type EmailKeywordRuleRow = {
  id: string
  tenant_id: string
  keyword: string
  active: boolean
  created_at: string
}

type RoutingConfig = {
  clientConfigs: ClientEmailConfigRow[]
  keywordRules: EmailKeywordRuleRow[]
  loadedAt: number
}

const CACHE_TTL_MS = 60_000
let routingConfigCache: RoutingConfig | null = null

async function getRoutingConfig(tenantId: string): Promise<RoutingConfig> {
  const now = Date.now()
  if (routingConfigCache && now - routingConfigCache.loadedAt < CACHE_TTL_MS) {
    return routingConfigCache
  }

  const rawDb = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const [clientConfigsRes, keywordRulesRes] = await Promise.all([
    rawDb
      .from('client_email_config')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('active', true),
    rawDb
      .from('email_keyword_rules')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('active', true),
  ])

  const config: RoutingConfig = {
    clientConfigs: (clientConfigsRes.data as ClientEmailConfigRow[]) ?? [],
    keywordRules: (keywordRulesRes.data as EmailKeywordRuleRow[]) ?? [],
    loadedAt: now,
  }
  routingConfigCache = config
  return config
}

function matchClientConfig(
  fromEmail: string,
  fromName: string,
  clientConfigs: ClientEmailConfigRow[]
): ClientEmailConfigRow | null {
  const emailLower = fromEmail.toLowerCase()
  const nameLower = fromName.toLowerCase()
  const domainPart = emailLower.split('@')[1] ?? ''

  for (const config of clientConfigs) {
    const patterns: SenderPattern[] = Array.isArray(config.sender_patterns)
      ? config.sender_patterns
      : []
    for (const pattern of patterns) {
      if (!pattern.active) continue
      const val = pattern.value.toLowerCase()
      if (pattern.type === 'domain' && domainPart.includes(val)) return config
      if (pattern.type === 'email' && emailLower === val) return config
      if (pattern.type === 'display_name' && nameLower.includes(val)) return config
    }
  }
  return null
}

function isOrderEmailByKeywords(subject: string, keywordRules: EmailKeywordRuleRow[]): boolean {
  const subjectLower = subject.toLowerCase()
  return keywordRules.some(rule => rule.active && subjectLower.includes(rule.keyword.toLowerCase()))
}

function isOwnDomain(email: string): boolean {
  return email.toLowerCase().endsWith(`@${OUR_DOMAIN}`)
}

function sanitizeAttachmentName(filename: string): string {
  return filename.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._\-]/g, '_')
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot).toLowerCase() : ''
}

async function uploadAttachments(
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
        `[email-inbound] BLOCKED executable attachment "${att.filename}" ext="${ext}" (msgId=${msgId}) — skipping`
      )
      continue
    }

    if (att.size > MAX_ATTACHMENT_BYTES) {
      console.warn(
        `[email-inbound] OVERSIZED attachment "${att.filename}" (${att.size}B > 50MB limit, msgId=${msgId}) — skipping`
      )
      continue
    }

    if (!att.data) {
      console.warn(
        `[email-inbound] attachment "${att.filename}" has no data (msgId=${msgId}) — skipping`
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
          `[email-inbound] Storage upload FAILED for "${att.filename}" (msgId=${msgId}):`,
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
        `[email-inbound] unexpected upload error for "${att.filename}" (msgId=${msgId}):`,
        err
      )
    }
  }

  return stored
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
  const token = req.nextUrl.searchParams.get('token')
  if (token !== process.env.GMAIL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Always return 200 — Pub/Sub retries on anything else.
  // after() keeps the serverless function alive until processWebhook completes,
  // even though the HTTP response is sent immediately.
  let body: PubSubBody
  try {
    body = await req.json() as PubSubBody
  } catch (err) {
    console.error('[email-inbound] failed to parse pub/sub body:', err)
    return NextResponse.json({ ok: true })
  }

  after(async () => {
    try {
      await processWebhook(body)
    } catch (err) {
      console.error('[email-inbound] unhandled processing error:', err)
    }
  })

  return NextResponse.json({ ok: true })
}

async function processWebhook(body: PubSubBody): Promise<void> {
  // TEMP VERBOSE LOGGING — remove after diagnosis
  console.log('[email-inbound] DIAG raw pub/sub message:', JSON.stringify(body.message).slice(0, 500))

  const supabase = createServiceClient()
  const rawDb = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const gmail = getGmailClient()

  // Decode Pub/Sub message
  let notification: { emailAddress: string; historyId: string }
  try {
    const rawDecoded = Buffer.from(body.message.data, 'base64').toString('utf-8')
    console.log('[email-inbound] DIAG decoded notification:', rawDecoded)
    notification = JSON.parse(rawDecoded) as { emailAddress: string; historyId: string }
    console.log('[email-inbound] DIAG parsed — emailAddress:', notification.emailAddress, '| newHistoryId:', notification.historyId)
  } catch (err) {
    console.error('[email-inbound] DIAG failed to decode pub/sub message:', err)
    return
  }

  const { emailAddress, historyId: newHistoryId } = notification

  // Look up tenant from email address
  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('id')
    .eq('contact_email', emailAddress)
    .single()

  let tenantId: string
  if (tenantRow) {
    tenantId = tenantRow.id
    console.log('[email-inbound] DIAG tenant matched by contact_email:', tenantId)
  } else {
    console.log('[email-inbound] DIAG no tenant matched contact_email, falling back to first tenant')
    const { data: firstTenant } = await supabase
      .from('tenants')
      .select('id')
      .limit(1)
      .single()
    if (!firstTenant) {
      console.error('[email-inbound] DIAG no tenant found at all — aborting')
      return
    }
    tenantId = firstTenant.id
    console.log('[email-inbound] DIAG using fallback tenantId:', tenantId)
  }

  // Load routing config from DB (cached 60s)
  const routingConfig = await getRoutingConfig(tenantId)

  // Get last known historyId
  const { data: syncState, error: syncStateError } = await rawDb
    .from('gmail_sync_state')
    .select('last_history_id')
    .eq('tenant_id', tenantId)
    .eq('email_address', emailAddress)
    .single()

  const storedHistoryId = (syncState as { last_history_id: string } | null)?.last_history_id ?? null
  const startHistoryId = storedHistoryId ?? newHistoryId

  console.log('[email-inbound] DIAG gmail_sync_state lookup — error:', syncStateError?.message ?? 'none')
  console.log('[email-inbound] DIAG storedHistoryId (from DB):', storedHistoryId)
  console.log('[email-inbound] DIAG newHistoryId  (from push):', newHistoryId)
  console.log('[email-inbound] DIAG startHistoryId (used for history.list):', startHistoryId)
  if (storedHistoryId === null) {
    console.log('[email-inbound] DIAG no stored historyId — using newHistoryId as start, history.list will likely return nothing')
  } else if (BigInt(startHistoryId) >= BigInt(newHistoryId)) {
    console.log('[email-inbound] DIAG WARNING: startHistoryId >= newHistoryId — history.list will return nothing (already caught up or ahead)')
  } else {
    console.log('[email-inbound] DIAG gap:', BigInt(newHistoryId) - BigInt(startHistoryId), 'history steps to walk')
  }

  // Fetch history since last known id
  let messageIds: string[] = []
  try {
    console.log('[email-inbound] DIAG calling gmail.users.history.list with startHistoryId:', startHistoryId)
    const histRes = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded'],
      labelId: 'INBOX',
    })

    const historyRecords = histRes.data.history ?? []
    console.log('[email-inbound] DIAG history.list returned', historyRecords.length, 'records, nextPageToken:', histRes.data.nextPageToken ?? 'none')

    for (const record of historyRecords) {
      for (const added of record.messagesAdded ?? []) {
        if (added.message?.id) {
          messageIds.push(added.message.id)
        }
      }
    }
    console.log('[email-inbound] DIAG messageIds to process:', messageIds)
  } catch (err) {
    console.error('[email-inbound] DIAG history.list error:', err)
    return
  }

  // Process each new message
  for (const msgId of messageIds) {
    try {
      // Deduplicate
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
      const msg = await extractMessageParts(raw)

      if (isOwnDomain(msg.fromEmail)) continue

      // Pre-generate the communications row ID so storage paths can be built
      // before we know which branch will handle this message.
      const communicationId = randomUUID()

      // Upload all attachment blobs now, once, before branching.
      // Each file is independently failable — failures are logged loudly and skipped
      // so a bad attachment never blocks the rest of the message.
      const storedAttachments: StoredAttachment[] = msg.attachments.length > 0
        ? await uploadAttachments(msg.attachments, tenantId, communicationId, rawDb, msgId)
        : []

      // Check if thread already exists in communications
      if (msg.threadId) {
        const { data: existingThread } = await supabase
          .from('communications')
          .select('id, job_id')
          .eq('tenant_id', tenantId)
          .eq('thread_id' as never, msg.threadId as never)
          .limit(1)
          .single()

        if (existingThread) {
          await supabase.from('communications').insert({
            id: communicationId,
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
            gmail_message_id: msg.gmailMessageId || null,
            source: 'inbound',
            attachments: storedAttachments,
          } as never)
          continue
        }
      }

      // Match sender against client email configs
      const matchedClientConfig = matchClientConfig(
        msg.fromEmail,
        msg.fromName,
        routingConfig.clientConfigs
      )

      const isOrderByPattern = matchedClientConfig !== null
      const isOrderByKeyword = isOrderEmailByKeywords(msg.subject, routingConfig.keywordRules)

      if (isOrderByPattern || isOrderByKeyword) {
        // Order pipeline routes to insurer_orders (via writeInsurerOrder), not communications.
        // Attachments have been uploaded; log storage paths so they can be retrieved manually
        // if needed. A future pass can link them to the insurer_order row.
        if (storedAttachments.length > 0) {
          console.log(
            `[email-inbound] order pipeline message ${msgId} has ${storedAttachments.length} uploaded attachment(s):`,
            storedAttachments.map(a => a.storage_path)
          )
        }

        let orderId: string | null = null
        const clientConfig: ClientEmailConfig | null = matchedClientConfig
          ? (matchedClientConfig as unknown as ClientEmailConfig)
          : null
        try {
          const parsed = await parseInsurerOrder(msg, clientConfig, tenantId)
          orderId = await writeInsurerOrder(parsed, msg, tenantId)
          await sendOrderNotification(orderId, parsed, msg, tenantId)
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
        let resolvedJobId: string | null = null
        let matchCandidates: unknown = null

        try {
          const match = await matchJob({
            subject: msg.subject,
            body: msg.bodyText,
            from_email: msg.fromEmail,
            tenant_id: tenantId,
          })
          if (match.job_id && match.confidence === 'high') {
            resolvedJobId = match.job_id
          } else if (match.candidates.length > 0) {
            matchCandidates = match.candidates
          }
        } catch (err) {
          console.error('[email-inbound] matchJob error:', err)
        }

        await supabase.from('communications').insert({
          id: communicationId,
          tenant_id: tenantId,
          job_id: resolvedJobId,
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
          source: resolvedJobId ? 'auto_linked' : 'unlinked',
          match_candidates: matchCandidates,
          attachments: storedAttachments,
        } as never)
      }
    } catch (err) {
      console.error(`[email-inbound] error processing message ${msgId}:`, err)
    }
  }

  // Update last processed historyId
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
