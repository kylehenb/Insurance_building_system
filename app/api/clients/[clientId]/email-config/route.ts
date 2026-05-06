import { NextRequest, NextResponse } from 'next/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { getUser } from '@/lib/supabase/get-user'

type SenderPattern = {
  type: 'domain' | 'email' | 'display_name'
  value: string
  active: boolean
}

type ClientEmailConfig = {
  id: string
  tenant_id: string
  client_id: string
  sender_patterns: SenderPattern[]
  insurer_hint: string | null
  custom_parsing_notes: string | null
  default_work_order_type: string | null
  active: boolean
  created_at: string
  updated_at: string
}

function getRawClient() {
  return createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const userSession = await getUser()
  if (!userSession || !userSession.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = userSession.tenant_id
  const { clientId } = await params

  const supabase = getRawClient()

  const { data: existing, error: fetchError } = await supabase
    .from('client_email_config')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('client_id', clientId)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (existing) {
    return NextResponse.json({ config: existing as ClientEmailConfig })
  }

  // No row exists — insert default and return it
  const { data: inserted, error: insertError } = await supabase
    .from('client_email_config')
    .insert({ tenant_id: tenantId, client_id: clientId })
    .select('*')
    .single()

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ config: inserted as ClientEmailConfig }, { status: 201 })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const userSession = await getUser()
  if (!userSession || !userSession.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = userSession.tenant_id
  const { clientId } = await params

  const body = await req.json() as Partial<Omit<ClientEmailConfig, 'id' | 'tenant_id' | 'client_id' | 'created_at' | 'updated_at'>>

  const supabase = getRawClient()

  const { data, error } = await supabase
    .from('client_email_config')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('client_id', clientId)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ config: data as ClientEmailConfig })
}
