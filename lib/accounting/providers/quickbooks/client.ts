/*
 * QBO Setup:
 * 1. Go to developer.intuit.com
 * 2. Sign in / create account
 * 3. Create a new app → select "QuickBooks Accounting" scope
 * 4. Copy Client ID and Client Secret to .env.local as QBO_CLIENT_ID and QBO_CLIENT_SECRET
 * 5. Add your redirect URI to allowed redirect URIs. Set QBO_ENVIRONMENT=sandbox for dev.
 *
 * Env vars required:
 *   QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI, QBO_ENVIRONMENT
 */

import type { SupabaseClient } from '@supabase/supabase-js'

interface AccountingCredentialsRow {
  id: string
  tenant_id: string
  provider: string
  realm_id: string
  access_token: string
  refresh_token: string
  token_expires_at: string
  refresh_expires_at: string
}

interface QboTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  x_refresh_token_expires_in: number
}

function getQboBaseUrl(realmId: string): string {
  const env = process.env.QBO_ENVIRONMENT ?? 'sandbox'
  if (env === 'production') {
    return `https://quickbooks.api.intuit.com/v3/company/${realmId}`
  }
  return `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}`
}

export async function refreshQboTokens(
  supabase: SupabaseClient,
  tenantId: string,
  creds: AccountingCredentialsRow
): Promise<AccountingCredentialsRow> {
  const clientId = process.env.QBO_CLIENT_ID!
  const clientSecret = process.env.QBO_CLIENT_SECRET!
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const res = await fetch(
    'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(creds.refresh_token)}`,
    }
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`QBO token refresh failed: ${res.status} ${body}`)
  }

  const json = (await res.json()) as QboTokenResponse

  const now = Date.now()
  const tokenExpiresAt = new Date(now + json.expires_in * 1000).toISOString()
  const refreshExpiresAt = new Date(
    now + json.x_refresh_token_expires_in * 1000
  ).toISOString()

  const { data, error } = await supabase
    .from('accounting_credentials')
    .update({
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      token_expires_at: tokenExpiresAt,
      refresh_expires_at: refreshExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('provider', 'quickbooks')
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(`Failed to save refreshed QBO tokens: ${error?.message}`)
  }

  return data as AccountingCredentialsRow
}

export async function qboFetch(
  supabase: SupabaseClient,
  tenantId: string,
  path: string,
  options?: RequestInit
): Promise<Response> {
  const { data: rawCreds, error: credsError } = await supabase
    .from('accounting_credentials')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('provider', 'quickbooks')
    .single()

  if (credsError || !rawCreds) {
    throw new Error(
      `No QuickBooks credentials found for tenant ${tenantId}: ${credsError?.message}`
    )
  }

  let creds = rawCreds as AccountingCredentialsRow

  // Refresh token if expiring within 5 minutes
  const expiresAt = new Date(creds.token_expires_at).getTime()
  const fiveMinutes = 5 * 60 * 1000
  if (Date.now() >= expiresAt - fiveMinutes) {
    creds = await refreshQboTokens(supabase, tenantId, creds)
  }

  const baseUrl = getQboBaseUrl(creds.realm_id)
  const url = `${baseUrl}${path}`

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${creds.access_token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  })

  return response
}
