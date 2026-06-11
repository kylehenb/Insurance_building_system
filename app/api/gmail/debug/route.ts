import { NextResponse } from 'next/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { getUser } from '@/lib/supabase/get-user'
import { getGmailClient } from '@/lib/gmail/client'
import { getFullMessage, extractMessageParts } from '@/lib/gmail/messages'
import { parseInsurerOrder } from '@/lib/email/order-parser'
import { writeInsurerOrder } from '@/lib/email/order-writer'
import { sendOrderNotification } from '@/lib/email/order-notifier'

const WATCHED_EMAIL = 'office@insurancerepairco.com.au'
const LABEL_LODGE_JOB = 'Lodge Job'
const LABEL_COMPLETE = 'Auto lodge complete'
const LABEL_FAILED = 'Auto Lodge failed'

async function getSessionAndClients() {
  const userSession = await getUser()
  if (!userSession?.tenant_id) return null
  const rawDb = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const gmail = getGmailClient()
  return { tenantId: userSession.tenant_id as string, rawDb, gmail }
}

// GET /api/gmail/debug — shows current state, does not process anything
export async function GET(): Promise<NextResponse> {
  const ctx = await getSessionAndClients()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId, rawDb, gmail } = ctx
  const diag: Record<string, unknown> = { tenantId }

  try {
    const { data: syncState } = await rawDb
      .from('gmail_sync_state')
      .select('polling_enabled, last_poll_timestamp, email_address')
      .eq('tenant_id', tenantId)
      .eq('email_address', WATCHED_EMAIL)
      .single()
    diag.syncState = syncState ?? 'no row found for watched email'
  } catch (e) {
    diag.syncStateError = String(e)
  }

  try {
    const labelsRes = await gmail.users.labels.list({ userId: 'me' })
    const allLabels = labelsRes.data.labels ?? []
    diag.allLabels = allLabels.map(l => ({ id: l.id, name: l.name }))

    const lodgeJobLabel = allLabels.find(l => l.name?.toLowerCase() === LABEL_LODGE_JOB.toLowerCase())
    diag.lodgeJobLabel = lodgeJobLabel
      ? { id: lodgeJobLabel.id, name: lodgeJobLabel.name }
      : 'NOT FOUND — create a label called "Lodge Job" in Gmail'

    if (lodgeJobLabel?.id) {
      const msgRes = await gmail.users.messages.list({
        userId: 'me',
        labelIds: [lodgeJobLabel.id],
        maxResults: 10,
      })
      diag.messagesWithLodgeJobLabel = msgRes.data.messages?.length ?? 0
      diag.messageIds = msgRes.data.messages?.map(m => m.id) ?? []
    }
  } catch (e) {
    diag.gmailError = String(e)
  }

  return NextResponse.json(diag)
}

// POST /api/gmail/debug — manually triggers the poll pipeline (same logic as cron)
export async function POST(): Promise<NextResponse> {
  const ctx = await getSessionAndClients()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId, rawDb, gmail } = ctx

  // Resolve label IDs
  const labelsRes = await gmail.users.labels.list({ userId: 'me' })
  const allLabels = labelsRes.data.labels ?? []
  const findId = (name: string) => allLabels.find(l => l.name?.toLowerCase() === name.toLowerCase())?.id ?? null

  const lodgeJobId = findId(LABEL_LODGE_JOB)
  if (!lodgeJobId) {
    return NextResponse.json({ error: `"${LABEL_LODGE_JOB}" label not found in Gmail` }, { status: 400 })
  }

  async function getOrCreate(name: string): Promise<string> {
    const id = findId(name)
    if (id) return id
    const res = await gmail.users.labels.create({
      userId: 'me',
      requestBody: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
    })
    return res.data.id!
  }

  const [completeId, failedId] = await Promise.all([
    getOrCreate(LABEL_COMPLETE),
    getOrCreate(LABEL_FAILED),
  ])

  const messagesRes = await gmail.users.messages.list({
    userId: 'me',
    labelIds: [lodgeJobId],
    maxResults: 50,
  })

  const messageIds = messagesRes.data.messages
    ?.map(m => m.id)
    .filter((id): id is string => Boolean(id)) ?? []

  if (messageIds.length === 0) {
    return NextResponse.json({ status: 'no_messages' })
  }

  const results: Array<{ messageId: string; status: string; error?: string }> = []

  for (const msgId of messageIds) {
    try {
      const raw = await getFullMessage(msgId)
      const msg = extractMessageParts(raw)

      try {
        const parsed = await parseInsurerOrder(msg, null, tenantId)
        const orderId = await writeInsurerOrder(parsed, msg, tenantId)
        await sendOrderNotification(orderId, parsed, msg, tenantId)
        await gmail.users.messages.modify({
          userId: 'me',
          id: msgId,
          requestBody: { removeLabelIds: [lodgeJobId], addLabelIds: [completeId] },
        })
        results.push({
          messageId: msgId,
          status: parsed.confidence > 0 ? 'lodged' : 'lodged_zero_confidence',
          confidence: parsed.confidence,
          parseStatus: parsed.parseStatus,
          claimNumber: parsed.data.claim_number ?? null,
          bodyTextLength: msg.bodyText.length,
        })
      } catch (pipelineErr) {
        await gmail.users.messages.modify({
          userId: 'me',
          id: msgId,
          requestBody: { removeLabelIds: [lodgeJobId], addLabelIds: [failedId] },
        })
        results.push({ messageId: msgId, status: 'failed', error: String(pipelineErr) })
      }
    } catch (fetchErr) {
      await gmail.users.messages.modify({
        userId: 'me',
        id: msgId,
        requestBody: { removeLabelIds: [lodgeJobId], addLabelIds: [failedId] },
      })
      results.push({ messageId: msgId, status: 'failed', error: String(fetchErr) })
    }
  }

  await rawDb
    .from('gmail_sync_state')
    .update({ last_poll_timestamp: new Date().toISOString(), last_synced_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('email_address', WATCHED_EMAIL)

  return NextResponse.json({ processed: results.length, results })
}
