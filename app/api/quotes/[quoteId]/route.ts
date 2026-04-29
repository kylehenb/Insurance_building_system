import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'
import { recomputeAndSaveStage } from '@/lib/jobs/recomputeStage'

async function createUnplacedWorkOrdersFromQuote(quoteId: string, jobId: string, tenantId: string) {
  const supabase = createServiceClient()

  // Fetch existing work orders per trade to allow per-trade duplicate detection.
  // This means re-running (e.g. on a second status change) will fill in any
  // trades that were missed on the first run rather than bailing out entirely.
  const { data: existingWOs } = await supabase
    .from('work_orders')
    .select('id, trade_id, trade_name')
    .eq('quote_id', quoteId)
    .eq('tenant_id', tenantId)

  const existingTradeIds = new Set(
    (existingWOs ?? []).map(wo => wo.trade_id).filter((id): id is string => id !== null)
  )

  // Track unmatched (trade_id=null) WOs by trade_name to prevent duplicates on re-run
  const existingNullTradeNames = new Set(
    (existingWOs ?? [])
      .filter(wo => wo.trade_id === null && wo.trade_name)
      .map(wo => wo.trade_name!.toLowerCase())
  )

  // Exclude items the insurer explicitly declined; include pending (full approval)
  // and approved (partial approval) items.
  const { data: scopeItems } = await supabase
    .from('scope_items')
    .select('*')
    .eq('quote_id', quoteId)
    .eq('tenant_id', tenantId)
    .or('approval_status.is.null,approval_status.neq.declined')

  if (!scopeItems || scopeItems.length === 0) {
    console.log(`[Auto-create] No scope items for quote ${quoteId}`)
    return
  }

  // Group by trade
  const itemsByTrade = new Map<string, typeof scopeItems>()
  scopeItems.forEach(item => {
    if (item.trade) {
      if (!itemsByTrade.has(item.trade)) {
        itemsByTrade.set(item.trade, [])
      }
      itemsByTrade.get(item.trade)!.push(item)
    }
  })

  // Build trade lookup by both primary_trade and business_name (case-insensitive)
  const { data: allTrades } = await supabase
    .from('trades')
    .select('*')
    .eq('tenant_id', tenantId)

  const tradeMap = new Map<string, string>()
  allTrades?.forEach(trade => {
    if (trade.primary_trade) {
      tradeMap.set(trade.primary_trade.toLowerCase(), trade.id)
    }
    if (trade.business_name) {
      tradeMap.set(trade.business_name.toLowerCase(), trade.id)
    }
  })

  // Get trade type sequence for visit counts
  const { data: tradeSequence } = await supabase
    .from('trade_type_sequence')
    .select('*')
    .eq('tenant_id', tenantId)

  const sequenceMap = new Map<string, number>()
  tradeSequence?.forEach(ts => {
    if (ts.trade_type) {
      sequenceMap.set(ts.trade_type.toLowerCase(), ts.typical_visit_count || 1)
    }
  })

  // Create unplaced work orders (no sequence_order)
  for (const [tradeName, items] of itemsByTrade) {
    const tradeNameLower = tradeName.toLowerCase()
    const tradeId = tradeMap.get(tradeNameLower) ?? null

    // Skip only if a work order for this exact trade already exists
    if (tradeId && existingTradeIds.has(tradeId)) {
      console.log(`[Auto-create] Work order already exists for trade ${tradeName}, skipping`)
      continue
    }

    if (!tradeId) {
      if (existingNullTradeNames.has(tradeNameLower)) {
        console.log(`[Auto-create] Unmatched work order already exists for trade "${tradeName}", skipping`)
        continue
      }
      console.log(`[Auto-create] No contractor record found for trade "${tradeName}" — creating work order without trade assignment`)
    }

    const totalVisits = sequenceMap.get(tradeNameLower) || 1
    const totalHours = items.reduce((sum, item) => sum + (item.estimated_hours || 0), 0)

    const { data: workOrder, error: woError } = await supabase
      .from('work_orders')
      .insert({
        tenant_id: tenantId,
        job_id: jobId,
        quote_id: quoteId,
        trade_id: tradeId,
        trade_name: tradeName,
        work_type: 'repair',
        status: 'pending',
        estimated_hours: totalHours,
        total_visits: totalVisits,
        current_visit: 1,
        gary_state: 'not_started',
        scope_summary: `${items.length} items`,
      })
      .select('id')
      .single()

    if (woError || !workOrder) {
      console.error(`[Auto-create] Failed to create work order for ${tradeName}:`, woError)
      continue
    }

    // Create visits
    for (let visitNum = 1; visitNum <= totalVisits; visitNum++) {
      const visitHours = totalHours / totalVisits
      await supabase
        .from('work_order_visits')
        .insert({
          tenant_id: tenantId,
          work_order_id: workOrder.id,
          job_id: jobId,
          visit_number: visitNum,
          estimated_hours: visitHours,
          status: 'unscheduled',
        })
    }

    console.log(`[Auto-create] Created unplaced work order for ${tradeName}`)
  }
}

type QuoteUpdate = Database['public']['Tables']['quotes']['Update']

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const { quoteId } = await params
  const tenantId = req.nextUrl.searchParams.get('tenantId')

  if (!tenantId) return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 })

  const supabase = createServiceClient()

  const { data: quote, error } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', quoteId)
    .eq('tenant_id', tenantId)
    .single()

  if (error || !quote) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: items } = await supabase
    .from('scope_items')
    .select('*')
    .eq('quote_id', quoteId)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })

  return NextResponse.json({ ...quote, items: items ?? [] })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const { quoteId } = await params
  const body = await req.json()
  const { tenantId, ...updates } = body as Record<string, unknown>

  const allowed: (keyof QuoteUpdate)[] = [
    'markup_pct',
    'gst_pct',
    'status',
    'notes',
    'is_locked',
    'total_amount',
    'permit_block_dismissed',
    'room_order',
  ]
  const safeUpdates: QuoteUpdate = {}
  for (const key of allowed) {
    if (key in updates) {
      ;(safeUpdates as Record<string, unknown>)[key] = updates[key]
    }
  }

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('quotes')
    .update(safeUpdates)
    .eq('id', quoteId)
    .eq('tenant_id', tenantId as string)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Recompute stage whenever quote status changes
  if ('status' in safeUpdates && data.job_id) {
    await recomputeAndSaveStage(data.job_id)

    // Auto-create unplaced work orders when quote is approved
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

    if (APPROVED_STATUSES.includes(safeUpdates.status as string)) {
      await createUnplacedWorkOrdersFromQuote(data.id, data.job_id, tenantId as string)
    }
  }

  return NextResponse.json(data)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const { quoteId } = await params
  const { tenantId } = (await req.json()) as { tenantId: string }

  const supabase = createServiceClient()

  const { error } = await supabase
    .from('quotes')
    .update({ is_active_version: false })
    .eq('id', quoteId)
    .eq('tenant_id', tenantId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
