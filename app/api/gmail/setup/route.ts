import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { startGmailWatch } from '@/lib/gmail/watch'

const WATCHED_EMAIL = 'office@insurancerepairco.com.au'

export async function POST(_req: NextRequest): Promise<NextResponse> {
  try {
    // Require authenticated user
    const authClient = await createClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createServiceClient()

    // Get tenant for this user
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const tenantId = profile.tenant_id

    // Register Gmail watch
    const watch = await startGmailWatch()

    // Upsert initial sync state — use untyped client for new table not yet in DB types
    const rawDb = createRawClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { error: upsertError } = await rawDb
      .from('gmail_sync_state')
      .upsert(
        {
          tenant_id: tenantId,
          email_address: WATCHED_EMAIL,
          last_history_id: watch.historyId,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,email_address' }
      )

    if (upsertError) {
      console.error('[gmail-setup] upsert error:', upsertError)
      return NextResponse.json({ error: 'Failed to save sync state' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      expiration: watch.expiration,
      historyId: watch.historyId,
    })
  } catch (err) {
    console.error('[gmail-setup] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
