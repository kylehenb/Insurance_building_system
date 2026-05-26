import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'

interface QboTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  x_refresh_token_expires_in: number
  token_type: string
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const realmId = searchParams.get('realmId')
  const tenantId = searchParams.get('state')

  if (!code || !realmId || !tenantId) {
    return NextResponse.redirect(
      new URL('/dashboard/settings/accounting?error=missing_params', req.url)
    )
  }

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

  // Use raw client for new tables not yet in Database types
  const rawDb = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

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

  const supabase = createServiceClient()
  await supabase
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
