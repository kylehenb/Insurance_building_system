import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'

interface UserRow {
  tenant_id: string
}

export async function GET(): Promise<NextResponse> {
  const cookieSupabase = await createClient()

  const { data: { user }, error: userError } = await cookieSupabase.auth.getUser()
  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: userRow, error: userRowError } = await cookieSupabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (userRowError || !userRow) {
    return NextResponse.json({ error: 'User record not found' }, { status: 404 })
  }

  const tenantId = (userRow as UserRow).tenant_id

  // oauth_state is not in the generated Database types — use the untyped client
  const rawDb = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Prune expired nonces (older than 10 minutes) to keep the table tidy
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  await rawDb.from('oauth_state').delete().lt('created_at', tenMinutesAgo)

  // Generate a cryptographically random nonce and store the nonce → tenantId mapping.
  // Only the nonce goes into the URL — tenantId never leaves the server during this leg.
  const nonce = randomBytes(32).toString('hex')
  const { error: insertError } = await rawDb.from('oauth_state').insert({
    nonce,
    tenant_id: tenantId,
    created_at: new Date().toISOString(),
  })

  if (insertError) {
    console.error('[accounting/auth] failed to store OAuth state:', insertError)
    return NextResponse.json({ error: 'Failed to initiate OAuth flow' }, { status: 500 })
  }

  const clientId = process.env.QBO_CLIENT_ID!
  const redirectUri = process.env.QBO_REDIRECT_URI!

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    state: nonce,
  })

  const url = `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`

  return NextResponse.json({ url })
}
