import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface UserRow {
  tenant_id: string
}

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient()

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: userRow, error: userRowError } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (userRowError || !userRow) {
    return NextResponse.json({ error: 'User record not found' }, { status: 404 })
  }

  const tenantId = (userRow as UserRow).tenant_id

  const clientId = process.env.QBO_CLIENT_ID!
  const redirectUri = process.env.QBO_REDIRECT_URI!

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    state: tenantId,
  })

  const url = `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`

  return NextResponse.json({ url })
}
