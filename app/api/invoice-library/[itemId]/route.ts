import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

interface Params {
  params: Promise<{ itemId: string }>
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { itemId } = await params
  const body = await req.json() as {
    tenantId: string
    description?: string
    default_quantity?: number
    default_unit_price?: number
    unit?: string
    invoice_type?: string
    sort_order?: number
    is_active?: boolean
  }

  const { tenantId, ...updates } = body

  if (!tenantId) {
    return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('invoice_line_item_library')
    .update(updates)
    .eq('id', itemId)
    .eq('tenant_id', tenantId)
    .select('*')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  }

  return NextResponse.json(data)
}
