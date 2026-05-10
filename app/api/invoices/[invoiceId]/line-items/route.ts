import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

interface Params {
  params: Promise<{ invoiceId: string }>
}

async function recalcInvoiceTotals(supabase: ReturnType<typeof import('@/lib/supabase/server').createServiceClient>, invoiceId: string, tenantId: string) {
  const { data: invoice } = await supabase
    .from('invoices')
    .select('gst_treatment')
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .single()

  if (invoice?.gst_treatment === 'inclusive') return

  const { data: items } = await supabase
    .from('invoice_line_items')
    .select('line_total')
    .eq('invoice_id', invoiceId)
    .eq('tenant_id', tenantId)

  const amountExGst = Math.round((items ?? []).reduce((sum, i) => sum + (i.line_total ?? 0), 0) * 100) / 100
  const gst = Math.round(amountExGst * 0.1 * 100) / 100
  const amountIncGst = Math.round((amountExGst + gst) * 100) / 100

  await supabase
    .from('invoices')
    .update({ amount_ex_gst: amountExGst, gst, amount_inc_gst: amountIncGst })
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
}

export async function GET(req: NextRequest, { params }: Params) {
  const { invoiceId } = await params
  const tenantId = req.nextUrl.searchParams.get('tenantId')

  if (!tenantId) {
    return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: lineItems, error } = await supabase
    .from('invoice_line_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(lineItems ?? [])
}

export async function POST(req: NextRequest, { params }: Params) {
  const { invoiceId } = await params
  const body = await req.json() as {
    tenantId: string
    description: string
    quantity: number
    unit_price: number
    unit?: string
    library_item_id?: string
  }

  const { tenantId, description, quantity, unit_price, unit, library_item_id } = body

  if (!tenantId || !description) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { count } = await supabase
    .from('invoice_line_items')
    .select('*', { count: 'exact', head: true })
    .eq('invoice_id', invoiceId)
    .eq('tenant_id', tenantId)

  const lineTotal = Math.round((quantity ?? 1) * (unit_price ?? 0) * 100) / 100

  const { data: lineItem, error } = await supabase
    .from('invoice_line_items')
    .insert({
      tenant_id: tenantId,
      invoice_id: invoiceId,
      description,
      quantity: quantity ?? 1,
      unit_price: unit_price ?? 0,
      line_total: lineTotal,
      unit: unit ?? null,
      library_item_id: library_item_id ?? null,
      sort_order: (count ?? 0),
    })
    .select('*')
    .single()

  if (error || !lineItem) {
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
  }

  await recalcInvoiceTotals(supabase, invoiceId, tenantId)

  return NextResponse.json(lineItem, { status: 201 })
}
