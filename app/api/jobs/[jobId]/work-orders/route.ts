import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  const tenantId = req.nextUrl.searchParams.get('tenantId')

  if (!tenantId) {
    return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 })
  }

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
      .order('sequence_order', { ascending: true, nullsFirst: false }),
    supabase
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
  const { jobId } = await params
  const body = await req.json().catch(() => ({}))
  const { tenantId } = body as { tenantId?: string }

  if (!tenantId) {
    return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Get the approved quote for this job
  const APPROVED_STATUSES = ['approved', 'partially_approved']

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

  // Get scope items for the quote — exclude explicitly declined items
  const { data: scopeItems, error: itemsError } = await supabase
    .from('scope_items')
    .select('*')
    .eq('quote_id', quote.id)
    .eq('tenant_id', tenantId)
    .or('approval_status.is.null,approval_status.neq.declined')

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

  // Fetch existing work orders for this quote to enable per-trade duplicate detection
  const { data: existingWOs } = await supabase
    .from('work_orders')
    .select('id, trade_id, trade_name, sequence_order, job_id')
    .eq('quote_id', quote.id)
    .eq('tenant_id', tenantId)

  // Delete orphaned work orders:
  // 1. Those with no trade_id and no trade_name (created by old sync code)
  // 2. Those linked to a different or null job_id — these were created by the
  //    auto-create trigger firing with a bad job_id and are invisible to the UI.
  const orphanedWOIds = (existingWOs ?? [])
    .filter(wo => (wo.trade_id === null && !wo.trade_name) || wo.job_id !== jobId)
    .map(wo => wo.id)

  if (orphanedWOIds.length > 0) {
    await supabase.from('work_order_visits').delete().in('work_order_id', orphanedWOIds).eq('tenant_id', tenantId)
    await supabase.from('work_orders').delete().in('id', orphanedWOIds).eq('tenant_id', tenantId)
  }

  // Remaining WOs after orphan cleanup
  const cleanExistingWOs = (existingWOs ?? []).filter(wo => !orphanedWOIds.includes(wo.id))

  const existingTradeIds = new Set(
    cleanExistingWOs.map(wo => wo.trade_id).filter((id): id is string => id !== null)
  )

  // Track unmatched (trade_id=null) WOs by trade_name to prevent duplicates
  const existingNullTradeNames = new Set(
    cleanExistingWOs
      .filter(wo => wo.trade_id === null && wo.trade_name)
      .map(wo => wo.trade_name!.toLowerCase())
  )

  // Start sequence_order after any already-placed work orders
  const maxExistingSeq = Math.max(0, ...cleanExistingWOs.map(wo => wo.sequence_order ?? 0))

  // Create work orders for each trade
  const workOrdersCreated: any[] = []
  let sequenceOrder = maxExistingSeq > 0 ? maxExistingSeq + 10 : 10

  for (const [tradeName, items] of itemsByTrade) {
    const tradeNameLower = tradeName.toLowerCase()

    // Get trade details by name (null if no registered contractor found)
    const trade = tradeMap.get(tradeNameLower) ?? null

    // Skip if a work order already exists for this specific trade
    if (trade && existingTradeIds.has(trade.id)) {
      console.log(`Work order already exists for trade ${tradeName}, skipping`)
      continue
    }

    if (!trade) {
      // Skip if an unmatched work order with this trade name already exists
      if (existingNullTradeNames.has(tradeNameLower)) {
        console.log(`Unmatched work order already exists for trade "${tradeName}", skipping`)
        continue
      }
      console.log(`No contractor record found for trade "${tradeName}" — creating work order without trade assignment`)
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
        trade_id: trade?.id ?? null,
        trade_name: tradeName,
        work_type: 'repair',
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

  const tradesInQuote = [...itemsByTrade.keys()]
  return NextResponse.json({
    success: true,
    workOrdersCreated,
    tradesInQuote,
    message: workOrdersCreated.length > 0
      ? `Created ${workOrdersCreated.length} work order${workOrdersCreated.length === 1 ? '' : 's'} from quote`
      : `No new work orders created — all ${tradesInQuote.length} trade${tradesInQuote.length === 1 ? '' : 's'} in the quote already have work orders`,
  })
}
