import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getAccountingProvider } from '@/lib/accounting/client'

interface UserRow {
  tenant_id: string
}

export async function GET(): Promise<NextResponse> {
  const cookieSupabase = await createClient()
  const { data: { user }, error: userError } = await cookieSupabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceSupabase = createServiceClient()

  const { data: userRow, error: userRowError } = await serviceSupabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (userRowError || !userRow) {
    return NextResponse.json({ error: 'User record not found' }, { status: 404 })
  }

  const tenantId = (userRow as UserRow).tenant_id

  try {
    const provider = await getAccountingProvider(serviceSupabase, tenantId)
    const accounts = await provider.getChartOfAccounts()
    return NextResponse.json({ accounts })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch accounts'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
