/**
 * Gmail API polling endpoint for email intake.
 *
 * Triggered by Vercel cron every 2 minutes.
 * Processes emails labelled "Lodge Job" in Gmail.
 *
 * Label outcomes:
 *   Order created (auto_parsed or needs_review) → "Auto lodge complete"
 *   Hard failure (pipeline error / fetch error)  → "Auto Lodge failed"
 *
 * To retry a failed email: re-label it "Lodge Job" in Gmail.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { getGmailClient } from '@/lib/gmail/client'
import { gmail_v1 } from 'googleapis'
import { getFullMessage, extractMessageParts } from '@/lib/gmail/messages'
import { parseInsurerOrder } from '@/lib/email/order-parser'
import { writeInsurerOrder } from '@/lib/email/order-writer'
import { sendOrderNotification } from '@/lib/email/order-notifier'

const WATCHED_EMAIL = 'office@insurancerepairco.com.au'

const LABEL_LODGE_JOB = 'Lodge Job'
const LABEL_COMPLETE = 'Auto lodge complete'
const LABEL_FAILED = 'Auto Lodge failed'

type LabelIds = {
  lodgeJob: string
  complete: string
  failed: string
}

async function resolveLabelIds(gmail: gmail_v1.Gmail): Promise<LabelIds | null> {
  const listRes = await gmail.users.labels.list({ userId: 'me' })
  const existing = listRes.data.labels ?? []
  const findId = (name: string) => existing.find(l => l.name === name)?.id ?? null

  const lodgeJobId = findId(LABEL_LODGE_JOB)
  if (!lodgeJobId) return null

  async function getOrCreate(name: string): Promise<string> {
    const id = findId(name)
    if (id) return id
    const res = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      },
    })
    return res.data.id!
  }

  const [completeId, failedId] = await Promise.all([
    getOrCreate(LABEL_COMPLETE),
    getOrCreate(LABEL_FAILED),
  ])

  return { lodgeJob: lodgeJobId, complete: completeId, failed: failedId }
}

async function swapLabel(
  gmail: gmail_v1.Gmail,
  msgId: string,
  removeLabelId: string,
  addLabelId: string
): Promise<void> {
  await gmail.users.messages.modify({
    userId: 'me',
    id: msgId,
    requestBody: {
      removeLabelIds: [removeLabelId],
      addLabelIds: [addLabelId],
    },
  })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
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

    // Check polling is enabled
    const { data: syncState } = await rawDb
      .from('gmail_sync_state')
      .select('polling_enabled')
      .eq('tenant_id', tenantId)
      .eq('email_address', WATCHED_EMAIL)
      .single()

    if (!syncState || !syncState.polling_enabled) {
      console.log('[gmail-poll] polling not enabled for tenant', tenantId)
      return NextResponse.json({ status: 'polling_disabled' })
    }

    // Resolve label IDs — auto-creates "Auto lodge complete" and "Auto Lodge failed" if missing
    const labelIds = await resolveLabelIds(gmail)
    if (!labelIds) {
      console.error(`[gmail-poll] "${LABEL_LODGE_JOB}" label not found in Gmail`)
      return NextResponse.json(
        { error: `"${LABEL_LODGE_JOB}" label not found. Please create it in Gmail first.` },
        { status: 400 }
      )
    }

    // Fetch all messages with "Lodge Job" label
    const messagesRes = await gmail.users.messages.list({
      userId: 'me',
      labelIds: [labelIds.lodgeJob],
      maxResults: 50,
    })

    const messageIds = messagesRes.data.messages
      ?.map(m => m.id)
      .filter((id): id is string => Boolean(id)) ?? []

    if (messageIds.length === 0) {
      await rawDb
        .from('gmail_sync_state')
        .update({ last_poll_timestamp: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('email_address', WATCHED_EMAIL)
      return NextResponse.json({ status: 'no_messages' })
    }

    console.log(`[gmail-poll] found ${messageIds.length} messages with "${LABEL_LODGE_JOB}" label`)

    let processedCount = 0
    let orderCount = 0

    for (const msgId of messageIds) {
      // Outer catch: message fetch / unexpected errors
      try {
        // Claim message to prevent double-processing across concurrent poll invocations
        const { count: claimedCount } = await rawDb
          .from('processed_gmail_messages')
          .upsert(
            { message_id: msgId, processed_at: new Date().toISOString() },
            { onConflict: 'message_id', ignoreDuplicates: true, count: 'exact' }
          )

        if (claimedCount === 0) {
          // Another concurrent poll invocation already claimed this message — skip
          continue
        }

        const raw = await getFullMessage(msgId)
        const msg = extractMessageParts(raw)
        processedCount++

        // Inner catch: order pipeline errors
        try {
          const parsed = await parseInsurerOrder(msg, null, tenantId)
          const orderId = await writeInsurerOrder(parsed, msg, tenantId)
          await sendOrderNotification(orderId, parsed, msg, tenantId)
          orderCount++
          await swapLabel(gmail, msgId, labelIds.lodgeJob, labelIds.complete)
        } catch (pipelineErr) {
          console.error(`[gmail-poll] pipeline error for message ${msgId}:`, pipelineErr)
          // Clear claim so the user can retry by re-labelling to "Lodge Job"
          await rawDb.from('processed_gmail_messages').delete().eq('message_id', msgId)
          await swapLabel(gmail, msgId, labelIds.lodgeJob, labelIds.failed)
        }

      } catch (msgErr) {
        console.error(`[gmail-poll] failed to process message ${msgId}:`, msgErr)
        await swapLabel(gmail, msgId, labelIds.lodgeJob, labelIds.failed)
      }
    }

    await rawDb
      .from('gmail_sync_state')
      .update({
        last_poll_timestamp: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('email_address', WATCHED_EMAIL)

    return NextResponse.json({ status: 'success', processedCount, orderCount })

  } catch (err) {
    console.error('[gmail-poll] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
