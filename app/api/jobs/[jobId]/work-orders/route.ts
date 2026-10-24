import { NextRequest, NextResponse } from 'next/server'
import { permissionDenied } from '@/lib/permissions/http'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'
import { WorkOrderEditError, syncWorkOrdersFromQuote } from '@/lib/work-orders/edit'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const { jobId } = await params
  const tenantId = me.tenantId

  const supabase = createServiceClient()

  const [
    { data: workOrders, error: woError },
    { data: visits, error: visitsError },
  ] = await Promise.all([
    supabase
      .from('work_orders')
      .select('*')
      .eq('job_id', jobId)
      .eq('tenant_id', tenantId)
      .order('sequence_order', { ascending: true, nullsFirst: false }), supabase
      .from('work_order_visits')
      .select('*')
      .eq('job_id', jobId)
      .eq('tenant_id', tenantId)
      .order('sequence_order', { ascending: true, nullsFirst: false }),
  ])

  if (woError) return NextResponse.json({ error: woError.message }, { status: 500 })
  if (visitsError) return NextResponse.json({ error: visitsError.message }, { status: 500 })

  return NextResponse.json({ workOrders: workOrders ?? [], visits: visits ?? [] })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const denied = await permissionDenied(me.tenantId, me.userId, 'jobs.edit')
  if (denied) return denied
  const { jobId } = await params

  try {
    const result = await syncWorkOrdersFromQuote(createServiceClient(), me.tenantId, jobId)
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    if (err instanceof WorkOrderEditError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}
