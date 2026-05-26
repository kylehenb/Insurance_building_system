import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'

interface UserRow {
  tenant_id: string
}

export async function POST(): Promise<NextResponse> {
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

  // Use raw client for new tables not yet in Database types
  const rawDb = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { error: deleteError } = await rawDb
    .from('accounting_credentials')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('provider', 'quickbooks')

  if (deleteError) {
    return NextResponse.json(
      { error: `Failed to remove credentials: ${deleteError.message}` },
      { status: 500 }
    )
  }

  await serviceSupabase
    .from('automation_config')
    .upsert(
      {
        tenant_id: tenantId,
        key: 'accounting_provider',
        value: '',
        description: 'Active accounting integration provider',
      },
      { onConflict: 'tenant_id,key' }
    )

  return NextResponse.json({ success: true })
}
