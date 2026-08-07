import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'

interface OAuthStateRow {
  tenant_id: string
  created_at: string
}

interface QboTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  x_refresh_token_expires_in: number
  token_type: string
}

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const realmId = searchParams.get('realmId')
  const nonce = searchParams.get('state')

  if (!code || !realmId || !nonce) {
    return NextResponse.redirect(
      new URL('/dashboard/settings/accounting?error=missing_params', req.url)
    )
  }

  // oauth_state and accounting_credentials are not in the generated Database types
  const rawDb = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // CSRF check: validate the nonce against the server-side store.
  // tenantId is retrieved from the DB — it is never read from the inbound URL.
  const { data: stateRow, error: stateError } = await rawDb
    .from('oauth_state')
    .select('tenant_id, created_at')
    .eq('nonce', nonce)
    .single()

  if (stateError || !stateRow) {
    console.error('[accounting/callback] unknown or already-used OAuth state nonce')
    return NextResponse.redirect(
      new URL('/dashboard/settings/accounting?error=invalid_state', req.url)
    )
  }

  const row = stateRow as OAuthStateRow

  // Enforce TTL — nonce must have been issued within the last 10 minutes
  const age = Date.now() - new Date(row.created_at).getTime()
  if (age > OAUTH_STATE_TTL_MS) {
    await rawDb.from('oauth_state').delete().eq('nonce', nonce)
    console.error('[accounting/callback] OAuth state nonce expired (age ms:', age, ')')
    return NextResponse.redirect(
      new URL('/dashboard/settings/accounting?error=state_expired', req.url)
    )
  }

  // Consume the nonce — one-time use, prevents replay
  await rawDb.from('oauth_state').delete().eq('nonce', nonce)

  // tenantId comes from the server-side DB row, not from the inbound URL
  const tenantId = row.tenant_id

  const clientId = process.env.QBO_CLIENT_ID!
  const clientSecret = process.env.QBO_CLIENT_SECRET!
  const redirectUri = process.env.QBO_REDIRECT_URI!
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const tokenRes = await fetch(
    'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
    }
  )

  if (!tokenRes.ok) {
    const body = await tokenRes.text()
    console.error('[accounting/callback] token exchange failed:', tokenRes.status, body)
    return NextResponse.redirect(
      new URL('/dashboard/settings/accounting?error=token_exchange_failed', req.url)
    )
  }

  const tokens = (await tokenRes.json()) as QboTokenResponse
  const now = Date.now()
  const tokenExpiresAt = new Date(now + tokens.expires_in * 1000).toISOString()
  const refreshExpiresAt = new Date(
    now + tokens.x_refresh_token_expires_in * 1000
  ).toISOString()

  const { error: credError } = await rawDb
    .from('accounting_credentials')
    .upsert(
      {
        tenant_id: tenantId,
        provider: 'quickbooks',
        realm_id: realmId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: tokenExpiresAt,
        refresh_expires_at: refreshExpiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,provider' }
    )

  if (credError) {
    console.error('[accounting/callback] failed to save credentials:', credError)
    return NextResponse.redirect(
      new URL('/dashboard/settings/accounting?error=save_failed', req.url)
    )
  }

  const serviceSupabase = createServiceClient()
  await serviceSupabase
    .from('automation_config')
    .upsert(
      {
        tenant_id: tenantId,
        key: 'accounting_provider',
        value: 'quickbooks',
        description: 'Active accounting integration provider',
      },
      { onConflict: 'tenant_id,key' }
    )

  return NextResponse.redirect(
    new URL('/dashboard/settings/accounting?connected=true', req.url)
  )
}
