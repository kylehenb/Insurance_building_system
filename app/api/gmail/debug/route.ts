import { NextResponse } from 'next/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { getUser } from '@/lib/supabase/get-user'
import { getGmailClient } from '@/lib/gmail/client'

const WATCHED_EMAIL = 'office@insurancerepairco.com.au'
const LABEL_LODGE_JOB = 'Lodge Job'

export async function GET(): Promise<NextResponse> {
  const userSession = await getUser()
  if (!userSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tenantId = userSession.tenant_id
  const rawDb = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const gmail = getGmailClient()
  const diag: Record<string, unknown> = { tenantId }

  try {
    // Sync state
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
    // All Gmail labels
    const labelsRes = await gmail.users.labels.list({ userId: 'me' })
    const allLabels = labelsRes.data.labels ?? []
    diag.allLabels = allLabels.map(l => ({ id: l.id, name: l.name }))

    const lodgeJobLabel = allLabels.find(
      l => l.name?.toLowerCase() === LABEL_LODGE_JOB.toLowerCase()
    )
    diag.lodgeJobLabel = lodgeJobLabel
      ? { id: lodgeJobLabel.id, name: lodgeJobLabel.name }
      : 'NOT FOUND — create a label called "Lodge Job" in Gmail'

    // Messages with Lodge Job label
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
