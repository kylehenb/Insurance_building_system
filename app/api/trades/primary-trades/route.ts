import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tenantId = searchParams.get('tenantId')
  if (!tenantId) return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 })

  const supabase = createServiceClient()

  const [{ data: tradesData, error }, { data: sequenceData }] = await Promise.all([
    supabase
      .from('trades')
      .select('primary_trade, trade_specialties')
      .eq('tenant_id', tenantId),
    supabase
      .from('trade_type_sequence')
      .select('trade_type')
      .eq('tenant_id', tenantId),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const collected = new Set<string>()
  tradesData?.forEach(t => {
    if (t.primary_trade) collected.add(t.primary_trade)
    t.trade_specialties?.forEach(s => { if (s) collected.add(s) })
  })
  sequenceData?.forEach(s => { if (s.trade_type) collected.add(s.trade_type) })

  const distinctTrades = [...collected].sort((a, b) => a.localeCompare(b))

  return NextResponse.json(distinctTrades, {
    headers: { 'Cache-Control': 'private, max-age=60' },
  })
}
