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
  const findId = (name: string) => existing.find(l => l.name?.toLowerCase() === name.toLowerCase())?.id ?? null

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


function checkCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  return !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`
}

async function runPoll(): Promise<NextResponse> {
  const rawDb = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const gmail = getGmailClient()

  try {
    // Look up sync state directly by email — derives tenantId from it, no brittle tenant lookup
    const { data: syncState } = await rawDb
      .from('gmail_sync_state')
      .select('tenant_id, polling_enabled')
      .eq('email_address', WATCHED_EMAIL)
      .single()

    console.log('[gmail-poll] syncState:', JSON.stringify(syncState))

    if (!syncState?.polling_enabled) {
      console.log('[gmail-poll] polling not enabled — returning polling_disabled')
      return NextResponse.json({ status: 'polling_disabled' })
    }

    const tenantId: string = syncState.tenant_id
    console.log('[gmail-poll] tenant:', tenantId)

    // Resolve label IDs — auto-creates "Auto lodge complete" and "Auto Lodge failed" if missing
    console.log('[gmail-poll] resolving labels...')
    const labelIds = await resolveLabelIds(gmail)
    console.log('[gmail-poll] labelIds:', JSON.stringify(labelIds))

    if (!labelIds) {
      console.error(`[gmail-poll] "${LABEL_LODGE_JOB}" label not found in Gmail`)
      return NextResponse.json(
        { error: `"${LABEL_LODGE_JOB}" label not found. Please create it in Gmail first.` },
        { status: 400 }
      )
    }

    // Fetch all messages with "Lodge Job" label
    console.log('[gmail-poll] fetching messages with labelId:', labelIds.lodgeJob)
    const messagesRes = await gmail.users.messages.list({
      userId: 'me',
      labelIds: [labelIds.lodgeJob],
      maxResults: 50,
    })

    const messageIds = messagesRes.data.messages
      ?.map(m => m.id)
      .filter((id): id is string => Boolean(id)) ?? []

    console.log(`[gmail-poll] messages found: ${messageIds.length}`, messageIds)

    if (messageIds.length === 0) {
      await rawDb
        .from('gmail_sync_state')
        .update({ last_poll_timestamp: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('email_address', WATCHED_EMAIL)
      return NextResponse.json({ status: 'no_messages' })
    }

    let processedCount = 0
    let orderCount = 0

    for (const msgId of messageIds) {
      console.log(`[gmail-poll] processing message ${msgId}`)
      // Outer catch: message fetch / unexpected errors
      try {
        const raw = await getFullMessage(msgId)
        const msg = await extractMessageParts(raw)

        if (msg.fromEmail.toLowerCase().endsWith('@insurancerepairco.com.au')) {
          console.log(`[gmail-poll] skipping own-domain message ${msgId} from ${msg.fromEmail}`)
          await swapLabel(gmail, msgId, labelIds.lodgeJob, labelIds.complete)
          continue
        }

        processedCount++

        // Inner catch: order pipeline errors
        try {
          const parsed = await parseInsurerOrder(msg, null, tenantId)
          const orderId = await writeInsurerOrder(parsed, msg, tenantId)
          if (orderId) {
            await sendOrderNotification(orderId, parsed, msg, tenantId)
            orderCount++
            console.log(`[gmail-poll] order created ${orderId} for message ${msgId}`)
          } else {
            console.log(`[gmail-poll] order rejected (is_new_order=false) for message ${msgId}`)
          }
          await swapLabel(gmail, msgId, labelIds.lodgeJob, labelIds.complete)
        } catch (pipelineErr) {
          console.error(`[gmail-poll] pipeline error for message ${msgId}:`, pipelineErr)
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

// Vercel Cron triggers via GET
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runPoll()
}

// Keep POST for manual/test invocation
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runPoll()
}
