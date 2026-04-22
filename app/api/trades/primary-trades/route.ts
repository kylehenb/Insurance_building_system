import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tenantId = searchParams.get('tenantId')
  if (!tenantId) return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 })

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('trades')
    .select('primary_trade')
    .eq('tenant_id', tenantId)
    .not('primary_trade', 'is', null)
    .order('primary_trade')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Get distinct values
  const distinctTrades = [...new Set(data?.map(t => t.primary_trade) || [])]
  
  return NextResponse.json(distinctTrades, {
    headers: { 'Cache-Control': 'private, max-age=300' },
  })
}
