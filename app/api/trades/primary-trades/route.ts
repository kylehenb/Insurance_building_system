import { NextRequest, NextResponse } from 'next/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const tenantId = me.tenantId

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('trade_type_sequence')
    .select('trade_type')
    .eq('tenant_id', tenantId)
    .order('trade_type', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const tradeTypes = (data ?? []).map(r => r.trade_type).filter(Boolean)

  return NextResponse.json(tradeTypes, {
    headers: { 'Cache-Control': 'private, max-age=60' },
  })
}
