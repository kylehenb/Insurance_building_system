import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  const invoiceType = req.nextUrl.searchParams.get('type')

  if (!tenantId) {
    return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 })
  }

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
  const body = await req.json() as {
    tenantId: string
    invoice_type: string
    description: string
    default_quantity?: number
    default_unit_price?: number
    unit?: string
    sort_order?: number
  }

  const { tenantId, invoice_type, description, default_quantity, default_unit_price, unit, sort_order } = body

  if (!tenantId || !invoice_type || !description) {
    return NextResponse.json({ error: 'Missing required fields: tenantId, invoice_type, description' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('invoice_line_item_library')
    .insert({
      tenant_id: tenantId,
      invoice_type,
      description,
      default_quantity: default_quantity ?? 1,
      default_unit_price: default_unit_price ?? null,
      unit: unit ?? null,
      sort_order: sort_order ?? 0,
      is_active: true,
    })
    .select('*')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
