import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
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

  const { data: quote, error: quoteError } = await supabase
    .from('quotes')
    .select('*')
    .eq('job_id', jobId)
    .eq('tenant_id', tenantId)
    .in('status', APPROVED_STATUSES)
    .eq('is_active_version', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (quoteError || !quote) {
    return NextResponse.json({ error: 'No approved quote found for this job' }, { status: 404 })
  }

  // Get scope items for the quote
  const { data: scopeItems, error: itemsError } = await supabase
    .from('scope_items')
    .select('*')
    .eq('quote_id', quote.id)
    .eq('tenant_id', tenantId)

  if (itemsError || !scopeItems || scopeItems.length === 0) {
    return NextResponse.json({ error: 'No scope items found for this quote' }, { status: 404 })
  }

  // Group scope items by trade (string field)
  const itemsByTrade = new Map<string, typeof scopeItems>()
  scopeItems.forEach(item => {
    if (item.trade) {
      if (!itemsByTrade.has(item.trade)) {
        itemsByTrade.set(item.trade, [])
      }
      itemsByTrade.get(item.trade)!.push(item)
    }
  })

  // Get all trades to map trade names to IDs
  const { data: allTrades } = await supabase
    .from('trades')
    .select('*')
    .eq('tenant_id', tenantId)

  const tradeMap = new Map<string, { id: string; primary_trade: string | null; business_name: string | null }>()
  allTrades?.forEach(trade => {
    if (trade.primary_trade) {
      tradeMap.set(trade.primary_trade.toLowerCase(), {
        id: trade.id,
        primary_trade: trade.primary_trade,
        business_name: trade.business_name,
      })
    }
    if (trade.business_name) {
      tradeMap.set(trade.business_name.toLowerCase(), {
        id: trade.id,
        primary_trade: trade.primary_trade,
        business_name: trade.business_name,
      })
    }
  })

  // Get trade type sequence for visit counts
  const { data: tradeSequence } = await supabase
    .from('trade_type_sequence')
    .select('*')
    .eq('tenant_id', tenantId)

  const sequenceMap = new Map<string, { order: number; visits: number }>()
  tradeSequence?.forEach(ts => {
    if (ts.trade_type) {
      sequenceMap.set(ts.trade_type.toLowerCase(), {
        order: ts.typical_sequence_order || 999,
        visits: ts.typical_visit_count || 1,
      })
    }
  })

  // Create work orders for each trade
  const workOrdersCreated: any[] = []
  let sequenceOrder = 10

  for (const [tradeName, items] of itemsByTrade) {
    const tradeNameLower = tradeName.toLowerCase()
    
    // Get trade details by name
    const trade = tradeMap.get(tradeNameLower)
    if (!trade) {
      console.log(`Trade not found: ${tradeName}`)
      continue
    }

    // Determine visit count from trade type sequence
    const sequenceInfo = sequenceMap.get(tradeNameLower)
    const totalVisits = sequenceInfo?.visits || 1

    // Calculate total estimated hours from scope items
    const totalHours = items.reduce((sum, item) => sum + (item.estimated_hours || 0), 0)

    // Create work order
    const { data: workOrder, error: woError } = await supabase
      .from('work_orders')
      .insert({
        tenant_id: tenantId,
        job_id: jobId,
        quote_id: quote.id,
        trade_id: trade.id,
        work_type: items[0].item_type || 'General',
        scope_summary: `${items.length} items`,
        estimated_hours: totalHours,
        total_visits: totalVisits,
        current_visit: 1,
        sequence_order: sequenceOrder,
        status: 'pending',
        gary_state: 'not_started',
      })
      .select('*')
      .single()

    if (woError || !workOrder) {
      console.error('Failed to create work order:', woError)
      continue
    }

    workOrdersCreated.push(workOrder)

    // Create work order visits
    for (let visitNum = 1; visitNum <= totalVisits; visitNum++) {
      const visitHours = totalHours / totalVisits
      const { error: visitError } = await supabase
        .from('work_order_visits')
        .insert({
          tenant_id: tenantId,
          work_order_id: workOrder.id,
          job_id: jobId,
          visit_number: visitNum,
          estimated_hours: visitHours,
          status: 'unscheduled',
        })

      if (visitError) {
        console.error('Failed to create work order visit:', visitError)
      }
    }

    sequenceOrder += 10
  }

  return NextResponse.json({
    success: true,
    workOrdersCreated,
    message: `Created ${workOrdersCreated.length} work orders from quote`,
  })
}
