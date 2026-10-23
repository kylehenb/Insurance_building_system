import { NextRequest, NextResponse } from 'next/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const tenantId = me.tenantId

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('trades')
    .select('id, primary_trade, trade_code, trade_specialties')
    .eq('tenant_id', tenantId)
    .order('primary_trade')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [], {
    headers: { 'Cache-Control': 'private, max-age=300' },
  })
}
