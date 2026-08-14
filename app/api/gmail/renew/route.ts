import { NextRequest, NextResponse } from 'next/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { startGmailWatch } from '@/lib/gmail/watch'

const WATCHED_EMAIL = 'office@insurancerepairco.com.au'

function checkCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  return !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`
}

async function renewWatch(): Promise<NextResponse> {

  const rawDb = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: syncState } = await rawDb
    .from('gmail_sync_state')
    .select('tenant_id')
    .eq('email_address', WATCHED_EMAIL)
    .limit(1)
    .single()

  if (!syncState) {
    console.error('[gmail-renew] No sync state row found — run /api/gmail/setup first')
    return NextResponse.json(
      { error: 'No sync state found — run /api/gmail/setup first' },
      { status: 404 }
    )
  }

  const tenantId = (syncState as { tenant_id: string }).tenant_id

  try {
    const watch = await startGmailWatch()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()

    await rawDb
      .from('gmail_sync_state')
      .upsert(
        {
          tenant_id: tenantId,
          email_address: WATCHED_EMAIL,
          last_history_id: watch.historyId,
          last_synced_at: now.toISOString(),
          expires_at: expiresAt,
          last_renewal_status: 'ok',
          last_renewal_error: null,
        },
        { onConflict: 'tenant_id,email_address' }
      )

    console.log(`[gmail-renew] Watch renewed — historyId=${watch.historyId} expires=${expiresAt}`)
    return NextResponse.json({ ok: true, historyId: watch.historyId, expiresAt })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[gmail-renew] Watch renewal failed:', err)

    await rawDb
      .from('gmail_sync_state')
      .update({
        last_renewal_status: 'error',
        last_renewal_error: message,
      })
      .eq('tenant_id', tenantId)
      .eq('email_address', WATCHED_EMAIL)

    return NextResponse.json(
      { error: 'Watch renewal failed', detail: message },
      { status: 502 }
    )
  }
}

// Vercel Cron triggers via GET — guard is the same CRON_SECRET Bearer check
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return renewWatch()
}

// Keep POST for manual/test invocation
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return renewWatch()
}
