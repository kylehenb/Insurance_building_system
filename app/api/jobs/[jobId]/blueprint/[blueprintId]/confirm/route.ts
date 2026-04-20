import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'
import type { BlueprintDraftData, BlueprintTrade, BlueprintVisit } from '@/lib/types/scheduling'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string; blueprintId: string }> }
) {
  const { jobId, blueprintId } = await params
  const supabase = createServiceClient()

  // Get the user's tenant_id from auth
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: userData } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (!userData) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const tenantId = userData.tenant_id

  // Get the blueprint
  const { data: blueprint, error: blueprintError } = await supabase
    .from('job_schedule_blueprints')
    .select('*')
    .eq('id', blueprintId)
    .eq('job_id', jobId)
    .eq('tenant_id', tenantId)
    .single()

  if (blueprintError || !blueprint) {
    return NextResponse.json({ error: 'Blueprint not found' }, { status: 404 })
  }

  if (blueprint.status !== 'draft') {
    return NextResponse.json({ error: 'Blueprint is not in draft status' }, { status: 400 })
  }

  const draftData = blueprint.draft_data as BlueprintDraftData | null
  if (!draftData || !draftData.trades || !Array.isArray(draftData.trades)) {
    return NextResponse.json({ error: 'Invalid blueprint draft data' }, { status: 400 })
  }

  // Get the approved quote for this job
  const APPROVED_STATUSES = [
    'approved_contracts_pending',
    'approved_contracts_sent',
    'approved_contracts_signed',
    'pre_repair',
    'repairs_in_progress',
    'repairs_complete_to_invoice',
    'complete_and_invoiced',
    'approved',
    'partially_approved',
  ]

  const { data: quote } = await supabase
    .from('quotes')
    .select('id')
    .eq('job_id', jobId)
    .eq('tenant_id', tenantId)
    .in('status', APPROVED_STATUSES)
    .eq('is_active_version', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!quote) {
    return NextResponse.json({ error: 'No approved quote found for this job' }, { status: 404 })
  }

  // Convert blueprint trades to work orders
  const workOrdersCreated: any[] = []
  const workOrderIds: string[] = []

  for (const blueprintTrade of draftData.trades) {
    // Create work order
    const { data: workOrder, error: woError } = await supabase
      .from('work_orders')
      .insert({
        tenant_id: tenantId,
        job_id: jobId,
        quote_id: quote.id,
        trade_id: blueprintTrade.trade_id || null,
        blueprint_id: blueprintId,
        work_type: 'repair',
        status: 'pending',
        sequence_order: blueprintTrade.sequence_order,
        is_concurrent: blueprintTrade.is_concurrent,
        predecessor_work_order_id: null, // Will set after all WOs are created
        estimated_hours: blueprintTrade.estimated_hours,
        total_visits: blueprintTrade.visits.length,
        current_visit: 1,
        proximity_range: blueprintTrade.proximity_range,
        gary_state: 'not_started',
        scope_summary: `${blueprintTrade.trade_type} - ${blueprintTrade.visits.length} visit(s)`,
      })
      .select('id')
      .single()

    if (woError || !workOrder) {
      console.error('Failed to create work order:', woError)
      continue
    }

    workOrdersCreated.push(workOrder)
    workOrderIds.push(workOrder.id)

    // Create work order visits
    for (const visit of blueprintTrade.visits) {
      const { error: visitError } = await supabase
        .from('work_order_visits')
        .insert({
          tenant_id: tenantId,
          work_order_id: workOrder.id,
          job_id: jobId,
          visit_number: visit.visit_number,
          estimated_hours: visit.estimated_hours,
          lag_days_after: visit.lag_days_after,
          lag_description: visit.lag_description,
          status: 'unscheduled',
        })

      if (visitError) {
        console.error('Failed to create work order visit:', visitError)
      }
    }
  }

  // Set predecessor relationships after all work orders are created
  for (let i = 0; i < draftData.trades.length; i++) {
    const blueprintTrade = draftData.trades[i]
    const workOrderId = workOrderIds[i]

    if (blueprintTrade.predecessor_index !== null && blueprintTrade.predecessor_index >= 0) {
      const predecessorId = workOrderIds[blueprintTrade.predecessor_index]
      if (predecessorId) {
        await supabase
          .from('work_orders')
          .update({ predecessor_work_order_id: predecessorId })
          .eq('id', workOrderId)
          .eq('tenant_id', tenantId)
      }
    }
  }

  // Update blueprint status to confirmed
  const { error: updateError } = await supabase
    .from('job_schedule_blueprints')
    .update({
      status: 'confirmed',
      confirmed_by: user.id,
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', blueprintId)
    .eq('tenant_id', tenantId)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to confirm blueprint' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    workOrdersCreated,
    message: `Created ${workOrdersCreated.length} work orders from blueprint`,
  })
}
