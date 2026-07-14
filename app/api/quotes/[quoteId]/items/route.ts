import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const { quoteId } = await params
  const { searchParams } = new URL(req.url)
  const tenantId = searchParams.get('tenantId')

  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('scope_items')
    .select('*')
    .eq('quote_id', quoteId)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const { quoteId } = await params
  const body = await req.json()
  const { tenantId, room, qty, rate_labour, rate_materials, ...rest } = body as {
    tenantId: string
    room: string | null
    qty: number | null
    rate_labour: number | null
    rate_materials: number | null
    [key: string]: unknown
  }

  const supabase = createServiceClient()

  const { data: maxSort } = await supabase
    .from('scope_items')
    .select('sort_order')
    .eq('quote_id', quoteId)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const sortOrder = (maxSort?.sort_order ?? 0) + 1

  const rateLabour = rate_labour ?? null
  const rateMaterials = rate_materials ?? null
  const ratesReady =
    (rateLabour !== null && rateLabour !== 0) ||
    (rateMaterials !== null && rateMaterials !== 0) ||
    (rateLabour !== null && rateMaterials !== null)
  const lineTotal =
    qty != null && ratesReady
      ? qty * ((rateLabour ?? 0) + (rateMaterials ?? 0))
      : null

  const { data, error } = await supabase
    .from('scope_items')
    .insert({
      tenant_id: tenantId,
      quote_id: quoteId,
      room: room ?? null,
      sort_order: sortOrder,
      qty,
      rate_labour: rateLabour,
      rate_materials: rateMaterials,
      rate_total: ratesReady
        ? (rateLabour ?? 0) + (rateMaterials ?? 0)
        : null,
      line_total: lineTotal,
      is_custom: (rest.is_custom as boolean | undefined) ?? true,
      ...(rest as object),
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
