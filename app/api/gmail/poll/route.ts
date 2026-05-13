/**
 * Gmail API polling endpoint for email intake.
 * 
 * Replaces Gmail Watch + Pub/Sub with simpler polling mechanism.
 * Called by Vercel cron job every 2 minutes.
 * 
 * This endpoint:
 * 1. Fetches new messages since last poll timestamp
 * 2. Processes them using the same logic as the webhook
 * 3. Updates last_poll_timestamp
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { getGmailClient } from '@/lib/gmail/client'
import { getFullMessage, extractMessageParts } from '@/lib/gmail/messages'
import { parseInsurerOrder } from '@/lib/email/order-parser'
import type { ClientEmailConfig } from '@/lib/email/order-parser'
import { writeInsurerOrder } from '@/lib/email/order-writer'
import { sendOrderNotification } from '@/lib/email/order-notifier'

const WATCHED_EMAIL = 'office@insurancerepairco.com.au'
const OUR_DOMAIN = 'insurancerepairco.com.au'

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

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Verify cron secret for security
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const rawDb = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const gmail = getGmailClient()

  try {
    // Get tenant
    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('id')
      .eq('contact_email', WATCHED_EMAIL)
      .single()

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
        console.error('[gmail-poll] no tenant found')
        return NextResponse.json({ error: 'No tenant found' }, { status: 404 })
      }
      tenantId = firstTenant.id
    }

    // Get sync state
    const { data: syncState } = await rawDb
      .from('gmail_sync_state')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('email_address', WATCHED_EMAIL)
      .single()

    // Check if polling is enabled
    if (!syncState || !syncState.polling_enabled) {
      console.log('[gmail-poll] polling not enabled for tenant', tenantId)
      return NextResponse.json({ status: 'polling_disabled' })
    }

    const lastPollTimestamp = syncState.last_poll_timestamp
      ? new Date(syncState.last_poll_timestamp).getTime()
      : Date.now() - 120000 // Default: 2 minutes ago

    // Ensure we don't go back more than 7 days to prevent picking up very old messages
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000)
    const effectiveTimestamp = Math.max(lastPollTimestamp, sevenDaysAgo)

    // Fetch messages since last poll, but not older than 7 days
    const searchQuery = `after:${Math.floor(effectiveTimestamp / 1000)} in:inbox`
    const messagesRes = await gmail.users.messages.list({
      userId: 'me',
      q: searchQuery,
      maxResults: 50,
    })

    const messageIds = messagesRes.data.messages?.map(m => m.id).filter((id): id is string => Boolean(id)) ?? []
    
    if (messageIds.length === 0) {
      console.log('[gmail-poll] no new messages')
      // Update poll timestamp even if no messages
      await rawDb.from('gmail_sync_state').update({
        last_poll_timestamp: new Date().toISOString(),
      }).eq('tenant_id', tenantId).eq('email_address', WATCHED_EMAIL)
      return NextResponse.json({ status: 'no_messages', messageIds: [] })
    }

    console.log(`[gmail-poll] found ${messageIds.length} new messages`)

    // Load routing config
    const routingConfig = await getRoutingConfig(tenantId)

    // Process each message
    let processedCount = 0
    let orderCount = 0
    let commCount = 0

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
          console.log(`[gmail-poll] skipping duplicate message ${msgId}`)
          continue
        }

        const raw = await getFullMessage(msgId)
        const msg = extractMessageParts(raw)

        if (isOwnDomain(msg.fromEmail)) {
          console.log(`[gmail-poll] skipping own domain message ${msgId}`)
          continue
        }

        processedCount++

        // Check if thread already exists in communications
        if (msg.threadId) {
          const { data: existingThread } = await supabase
            .from('communications')
            .select('id, job_id')
            .eq('tenant_id', tenantId)
            .eq('thread_id', msg.threadId)
            .limit(1)
            .maybeSingle()

          if (existingThread) {
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
            })
            commCount++
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
          let orderId: string | null = null
          const clientConfig: ClientEmailConfig | null = matchedClientConfig
            ? (matchedClientConfig as unknown as ClientEmailConfig)
            : null
          try {
            const parsed = await parseInsurerOrder(msg, clientConfig, tenantId)
            orderId = await writeInsurerOrder(parsed, msg, tenantId)
            await sendOrderNotification(orderId, parsed, msg, tenantId)
            orderCount++
          } catch (err) {
            console.error(`[gmail-poll] order pipeline error for ${msgId}:`, err)
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
                console.error(`[gmail-poll] fallback order insert failed for ${msgId}:`, fbErr)
              }
            }
          }
        } else {
          await supabase.from('communications').insert({
            tenant_id: tenantId,
            job_id: null,
            type: 'email',
            direction: 'inbound',
            subject: msg.subject,
            content: msg.bodyText,
            created_at: msg.receivedAt,
            thread_id: msg.threadId || null,
            from_email: msg.fromEmail,
            to_email: msg.to,
            body_text: msg.bodyText,
            source: 'unlinked',
          })
          commCount++
        }
      } catch (err) {
        console.error(`[gmail-poll] error processing message ${msgId}:`, err)
      }
    }

    // Update last poll timestamp
    await rawDb.from('gmail_sync_state').update({
      last_poll_timestamp: new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
    }).eq('tenant_id', tenantId).eq('email_address', WATCHED_EMAIL)

    return NextResponse.json({
      status: 'success',
      processedCount,
      orderCount,
      commCount,
      messageIds,
    })

  } catch (err) {
    console.error('[gmail-poll] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
