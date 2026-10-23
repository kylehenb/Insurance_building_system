import { NextRequest, NextResponse } from 'next/server'
import { permissionDenied } from '@/lib/permissions/http'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const tenantId = me.tenantId
  const invoiceType = req.nextUrl.searchParams.get('type')

  const supabase = createServiceClient()

  let query = supabase
    .from('invoice_line_item_library')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (invoiceType) {
    query = query.eq('invoice_type', invoiceType)
  }

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const denied = await permissionDenied(me.tenantId, me.userId, 'settings.edit')
  if (denied) return denied
  const body = await req.json() as {
    tenantId: string
    invoice_type: string
    description: string
    default_quantity?: number
    default_unit_price?: number
    unit?: string
    sort_order?: number
  }

  const { invoice_type, description, default_quantity, default_unit_price, unit, sort_order } = body
  const tenantId = me.tenantId

  if (!invoice_type || !description) {
    return NextResponse.json({ error: 'Missing required fields: invoice_type, description' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('invoice_line_item_library')
    .insert({
      tenant_id: tenantId, invoice_type, description, default_quantity: default_quantity ?? 1, default_unit_price: default_unit_price ?? null, unit: unit ?? null, sort_order: sort_order ?? 0, is_active: true,
    })
    .select('*')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
