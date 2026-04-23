import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tenantId = searchParams.get('tenantId')
  const insurer = searchParams.get('insurer')

  if (!tenantId) return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 })

  const supabase = createServiceClient()

  let query = supabase
    .from('scope_library')
    .select(
      'id, insurer_specific, trade, keyword, item_description, unit, labour_per_unit, materials_per_unit, total_per_unit, estimated_hours'
    )
    .eq('tenant_id', tenantId)

  const { data, error } = await query.order('item_description')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [], {
    headers: { 'Cache-Control': 'private, max-age=300' },
  })
}
