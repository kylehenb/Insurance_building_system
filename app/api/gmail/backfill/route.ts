/**
 * One-time (repeatable) backfill for Gmail messages missed during a watch gap.
 *
 * GET  /api/gmail/backfill?since=2026/06/11
 *   → dry-run count: { since, total, alreadyProcessed, toProcess }
 *   Call this first — it makes no writes.
 *
 * POST /api/gmail/backfill  (body: { since?: string, max?: number })
 *   → processes up to `max` (default 50) unprocessed inbox messages since `since`.
 *   Identical routing logic to /api/webhooks/email-inbound.
 *   Uses `processed_gmail_messages` for deduplication — safe to run multiple times.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { getUser } from '@/lib/supabase/get-user'
import { getGmailClient } from '@/lib/gmail/client'
import { getFullMessage, extractMessageParts } from '@/lib/gmail/messages'
import { parseInsurerOrder } from '@/lib/email/order-parser'
import type { ClientEmailConfig } from '@/lib/email/order-parser'
import { writeInsurerOrder } from '@/lib/email/order-writer'
import { sendOrderNotification } from '@/lib/email/order-notifier'

const OUR_DOMAIN = 'insurancerepairco.com.au'
const DEFAULT_SINCE = '2026/06/11'
const DEFAULT_MAX = 50

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
}

type EmailKeywordRuleRow = {
  id: string
  tenant_id: string
  keyword: string
  active: boolean
}

function isOwnDomain(email: string): boolean {
  return email.toLowerCase().endsWith(`@${OUR_DOMAIN}`)
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

function isOrderEmailByKeywords(subject: string, rules: EmailKeywordRuleRow[]): boolean {
  const lower = subject.toLowerCase()
  return rules.some(r => r.active && lower.includes(r.keyword.toLowerCase()))
}

async function listInboxSince(since: string): Promise<string[]> {
  const gmail = getGmailClient()
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: `after:${since}`,
      labelIds: ['INBOX'],
      maxResults: 500,
      ...(pageToken ? { pageToken } : {}),
    })
    for (const m of res.data.messages ?? []) {
      if (m.id) ids.push(m.id)
    }
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)
  return ids
}

async function getProcessedSet(ids: string[]): Promise<Set<string>> {
  const rawDb = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const processed = new Set<string>()
  const CHUNK = 400
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const { data } = await rawDb
      .from('processed_gmail_messages')
      .select('message_id')
      .in('message_id', chunk)
    for (const row of data ?? []) {
      processed.add((row as { message_id: string }).message_id)
    }
  }
  return processed
}

// ── GET — dry-run count, no writes ────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const userSession = await getUser()
  if (!userSession?.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const since = req.nextUrl.searchParams.get('since') ?? DEFAULT_SINCE

  let allIds: string[]
  try {
    allIds = await listInboxSince(since)
  } catch (err) {
    return NextResponse.json({ error: 'Gmail list failed', detail: String(err) }, { status: 502 })
  }

  const alreadyProcessed = await getProcessedSet(allIds)

  return NextResponse.json({
    since,
    total: allIds.length,
    alreadyProcessed: alreadyProcessed.size,
    toProcess: allIds.length - alreadyProcessed.size,
  })
}

// ── POST — process up to `max` messages ───────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const userSession = await getUser()
  if (!userSession?.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = userSession.tenant_id

  let since = DEFAULT_SINCE
  let max = DEFAULT_MAX
  try {
    const body = await req.json() as { since?: unknown; max?: unknown }
    if (typeof body.since === 'string' && body.since) since = body.since
    if (typeof body.max === 'number' && body.max > 0) max = body.max
  } catch {
    // body is optional
  }

  const rawDb = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const supabase = createServiceClient()
  const gmail = getGmailClient()

  // Load routing config
  const [clientConfigsRes, keywordRulesRes] = await Promise.all([
    rawDb.from('client_email_config').select('*').eq('tenant_id', tenantId).eq('active', true),
    rawDb.from('email_keyword_rules').select('*').eq('tenant_id', tenantId).eq('active', true),
  ])
  const clientConfigs = (clientConfigsRes.data as ClientEmailConfigRow[]) ?? []
  const keywordRules = (keywordRulesRes.data as EmailKeywordRuleRow[]) ?? []

  // List all inbox IDs since gap start
  let allIds: string[]
  try {
    allIds = await listInboxSince(since)
  } catch (err) {
    return NextResponse.json({ error: 'Gmail list failed', detail: String(err) }, { status: 502 })
  }

  const alreadyProcessed = await getProcessedSet(allIds)
  const toProcess = allIds.filter(id => !alreadyProcessed.has(id)).slice(0, max)

  type ResultEntry = {
    messageId: string
    status: 'skipped_own_domain' | 'thread_continuation' | 'order' | 'unlinked' | 'duplicate' | 'error'
    detail?: string
  }
  const results: ResultEntry[] = []

  for (const msgId of toProcess) {
    try {
      // Claim (idempotent — another process might race us on repeated runs)
      const { count: claimed } = await rawDb
        .from('processed_gmail_messages')
        .upsert(
          { message_id: msgId, processed_at: new Date().toISOString() },
          { onConflict: 'message_id', ignoreDuplicates: true, count: 'exact' }
        )
      if (claimed === 0) {
        results.push({ messageId: msgId, status: 'duplicate' })
        continue
      }

      const raw = await getFullMessage(msgId)
      const msg = await extractMessageParts(raw)

      if (isOwnDomain(msg.fromEmail)) {
        results.push({ messageId: msgId, status: 'skipped_own_domain' })
        continue
      }

      // Thread continuation — link to existing job if thread already in communications
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
            source: 'backfill',
          } as never)
          results.push({
            messageId: msgId,
            status: 'thread_continuation',
            detail: existingThread.job_id ?? 'unlinked thread',
          })
          continue
        }
      }

      // Order routing — same pattern as inbound webhook
      const matchedConfig = matchClientConfig(msg.fromEmail, msg.fromName, clientConfigs)
      const isOrder = matchedConfig !== null || isOrderEmailByKeywords(msg.subject, keywordRules)

      if (isOrder) {
        try {
          const parsed = await parseInsurerOrder(
            msg,
            matchedConfig as unknown as ClientEmailConfig | null,
            tenantId
          )
          const orderId = await writeInsurerOrder(parsed, msg, tenantId)
          await sendOrderNotification(orderId, parsed, msg, tenantId)
          results.push({ messageId: msgId, status: 'order', detail: orderId })
        } catch (err) {
          console.error(`[gmail-backfill] order pipeline error for ${msgId}:`, err)
          results.push({ messageId: msgId, status: 'error', detail: String(err) })
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
          thread_id: msg.threadId,
          from_email: msg.fromEmail,
          to_email: msg.to,
          body_text: msg.bodyText,
          gmail_message_id: msg.gmailMessageId || null,
          source: 'backfill',
        } as never)
        results.push({ messageId: msgId, status: 'unlinked' })
      }
    } catch (err) {
      console.error(`[gmail-backfill] error processing ${msgId}:`, err)
      results.push({ messageId: msgId, status: 'error', detail: String(err) })
    }
  }

  const remaining = allIds.length - alreadyProcessed.size - toProcess.length

  return NextResponse.json({
    since,
    max,
    found: allIds.length,
    alreadyProcessed: alreadyProcessed.size,
    attempted: toProcess.length,
    remaining,
    results,
  })
}
