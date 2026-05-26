import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'

interface UserRow {
  tenant_id: string
}

interface AccountMappingRow {
  irc_category: string
  accounting_account_id: string
  accounting_account_name: string
}

interface SaveMappingInput {
  irc_category: string
  accounting_account_id: string
  accounting_account_name: string
}

interface SaveMappingsBody {
  mappings: SaveMappingInput[]
}

async function getAuthenticatedTenantId(cookieSupabase: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const { data: { user }, error: userError } = await cookieSupabase.auth.getUser()
  if (userError || !user) return null

  const serviceSupabase = createServiceClient()
  const { data: userRow, error: userRowError } = await serviceSupabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (userRowError || !userRow) return null
  return (userRow as UserRow).tenant_id
}

export async function GET(): Promise<NextResponse> {
  const cookieSupabase = await createClient()
  const tenantId = await getAuthenticatedTenantId(cookieSupabase)

  if (!tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Use raw client for new tables not yet in Database types
  const rawDb = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await rawDb
    .from('accounting_account_map')
    .select('irc_category, accounting_account_id, accounting_account_name')
    .eq('tenant_id', tenantId)

  if (error) {
    return NextResponse.json(
      { error: `Failed to fetch mappings: ${error.message}` },
      { status: 500 }
    )
  }

  const mappings = (data ?? []) as AccountMappingRow[]
  return NextResponse.json({ mappings })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cookieSupabase = await createClient()
  const tenantId = await getAuthenticatedTenantId(cookieSupabase)

  if (!tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: SaveMappingsBody
  try {
    body = (await req.json()) as SaveMappingsBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.mappings)) {
    return NextResponse.json({ error: 'mappings must be an array' }, { status: 400 })
  }

  const rawDb = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const upsertRows = body.mappings.map((m) => ({
    tenant_id: tenantId,
    irc_category: m.irc_category,
    accounting_account_id: m.accounting_account_id,
    accounting_account_name: m.accounting_account_name,
    updated_at: new Date().toISOString(),
  }))

  const { error } = await rawDb
    .from('accounting_account_map')
    .upsert(upsertRows, { onConflict: 'tenant_id,irc_category' })

  if (error) {
    return NextResponse.json(
      { error: `Failed to save mappings: ${error.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}
