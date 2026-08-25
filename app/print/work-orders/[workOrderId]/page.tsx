import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'
import { generateWorkOrderHtml } from '@/lib/documents/work-order-html'
import { resolveOwnedScopeItems } from '@/lib/work-orders/scope-item-ownership'
import { WorkOrderPrintButton } from './WorkOrderPrintButton'

type WorkOrder = Database['public']['Tables']['work_orders']['Row']
type Job = Database['public']['Tables']['jobs']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']
type Trade = Database['public']['Tables']['trades']['Row']
type ScopeItem = Database['public']['Tables']['scope_items']['Row']
type Quote = Database['public']['Tables']['quotes']['Row']

export default async function WorkOrderPrintPage({
  params,
}: {
  params: Promise<{ workOrderId: string }>
}) {
  const { workOrderId } = await params

  const supabase = await createClient()

  // Check authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }

  // Get user's tenant_id
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (userError || !userData) {
    redirect('/login')
  }

  const tenantId = userData.tenant_id

  // Fetch work order
  const { data: workOrder, error: workOrderError } = await supabase
    .from('work_orders')
    .select('*')
    .eq('id', workOrderId)
    .eq('tenant_id', tenantId)
    .single()

  if (workOrderError || !workOrder) {
    return <div>Work order not found</div>
  }

  // Fetch job details
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', workOrder.job_id)
    .eq('tenant_id', tenantId)
    .single()

  if (jobError || !job) {
    return <div>Job not found</div>
  }

  // Fetch trade details
  let trade: Trade | null = null
  if (workOrder.trade_id) {
    const { data: tradeData, error: tradeError } = await supabase
      .from('trades')
      .select('*')
      .eq('id', workOrder.trade_id)
      .eq('tenant_id', tenantId)
      .single()

    if (!tradeError && tradeData) {
      trade = tradeData
    }
  }

  // Fetch quote to get scope items
  let quote: Quote | null = null
  if (workOrder.quote_id) {
    const { data: quoteData, error: quoteError } = await supabase
      .from('quotes')
      .select('*')
      .eq('id', workOrder.quote_id)
      .eq('tenant_id', tenantId)
      .single()

    if (!quoteError && quoteData) {
      quote = quoteData
    }
  }

  // Fetch every work order sharing this quote — needed to resolve which items
  // *other* trades currently own (their own custom items, edits, reassignments),
  // not just what the quote originally said.
  let quoteWorkOrders: WorkOrder[] = []
  if (quote) {
    const { data } = await supabase
      .from('work_orders')
      .select('*')
      .eq('quote_id', quote.id)
      .eq('tenant_id', tenantId)
    quoteWorkOrders = data ?? []
  }

  // Fetch all scope items for the quote
  let rawScopeItems: ScopeItem[] = []
  if (quote) {
    const { data: scopeItems, error: scopeError } = await supabase
      .from('scope_items')
      .select('*')
      .eq('quote_id', quote.id)
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true })

    if (!scopeError && scopeItems) {
      rawScopeItems = scopeItems
    }
  }

  // Contractor lookup, for labelling other trades' items with who's doing them
  const { data: allTrades } = await supabase
    .from('trades')
    .select('*')
    .eq('tenant_id', tenantId)
  const tradesById = new Map((allTrades ?? []).map(t => [t.id, t]))

  function tradeLabelFor(wo: WorkOrder): string | null {
    const t = wo.trade_id ? tradesById.get(wo.trade_id) ?? null : null
    return wo.trade_name ?? t?.primary_trade ?? null
  }

  function contractorNameFor(wo: WorkOrder): string | null {
    const t = wo.trade_id ? tradesById.get(wo.trade_id) ?? null : null
    return t?.business_name || t?.primary_trade || null
  }

  // Apply a work order's own notes overlay (custom items, edited descriptions/
  // qty, soft-deletions) so the PDF reflects what's actually in the work
  // orders table for it, not the original quote prices.
  function parseWONotes(wo: WorkOrder) {
    if (!wo.notes) return { overrides: {} as Record<string, Partial<ScopeItem>>, addedItems: [] as ScopeItem[], deletedIds: new Set<string>() }
    try {
      const p = JSON.parse(wo.notes) as Record<string, unknown>
      const overrides = (typeof p.item_overrides === 'object' && p.item_overrides && !Array.isArray(p.item_overrides))
        ? p.item_overrides as Record<string, Partial<ScopeItem>>
        : {} as Record<string, Partial<ScopeItem>>
      const addedRaw = Array.isArray(p.added_items) ? p.added_items as Array<{
        id: string; item_description: string; qty: number;
        rate_labour: number; rate_materials: number; line_total: number;
        room: string | null; trade: string | null;
      }> : []
      const addedItems: ScopeItem[] = addedRaw.map(item => ({
        id:                       item.id,
        quote_id:                 wo.quote_id ?? '',
        tenant_id:                tenantId,
        item_description:         item.item_description,
        qty:                      item.qty,
        rate_labour:              item.rate_labour,
        rate_materials:           item.rate_materials,
        rate_total:               (item.rate_labour || 0) + (item.rate_materials || 0),
        line_total:               item.line_total,
        room:                     item.room,
        trade:                    item.trade,
        assigned_work_order_id:   wo.id,
        unit:                     null,
        room_length:              null,
        room_width:               null,
        room_height:              null,
        sort_order:               null,
        is_custom:                true,
        is_reference:             null,
        approval_status:          null,
        item_type:                null,
        keyword:                  null,
        library_writeback_approved: null,
        preliminary_formula:      null,
        scope_library_id:         null,
        split_type:               null,
        estimated_hours:          null,
        trade_rate_total:         null,
        created_at:               null,
      }))
      const deletedIds = new Set(Array.isArray(p.deleted_scope_item_ids) ? p.deleted_scope_item_ids as string[] : [])
      return { overrides, addedItems, deletedIds }
    } catch {
      return { overrides: {} as Record<string, Partial<ScopeItem>>, addedItems: [] as ScopeItem[], deletedIds: new Set<string>() }
    }
  }

  // Resolve the final item list a given work order owns: explicit assignment
  // or trade match (never both a trade's original WO and a WO it was
  // reassigned to — see resolveOwnedScopeItems), then that WO's own edits.
  function resolveItemsForWO(wo: WorkOrder): ScopeItem[] {
    const owned = resolveOwnedScopeItems({ id: wo.id, tradeLabel: tradeLabelFor(wo) }, rawScopeItems)
    const { overrides, addedItems, deletedIds } = parseWONotes(wo)
    const withOverrides = owned
      .filter(item => !deletedIds.has(item.id))
      .map(item => { const o = overrides[item.id]; return o ? { ...item, ...o } : item })
    return [...withOverrides, ...addedItems]
  }

  const tradeScopeItems = resolveItemsForWO(workOrder)

  // Other trades' items, as each of their own work orders currently resolves
  // them — an item with no owning work order (unallocated) appears nowhere,
  // by design: unallocated usually means the repair isn't going ahead.
  const otherScopeItems = quoteWorkOrders
    .filter(wo => wo.id !== workOrder.id)
    .flatMap(wo => resolveItemsForWO(wo).map(item => ({
      ...item,
      trade: tradeLabelFor(wo) ?? item.trade,
      contractorName: contractorNameFor(wo),
    })))

  // Fetch tenant details
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', tenantId)
    .single()

  if (tenantError || !tenant) {
    return <div>Tenant not found</div>
  }

  const html = generateWorkOrderHtml({
    workOrder,
    job,
    tenant: tenant as Tenant & {
      building_licence_number?: string | null
    },
    trade,
    tradeScopeItems,
    otherScopeItems,
    generatedDate: new Date(),
  })

  return (
    <div className="min-h-screen bg-[#f5f2ee] print:bg-white">
      {/* Print controls */}
      <div className="max-w-4xl mx-auto bg-white shadow-lg min-h-screen print:shadow-none print:min-h-0 relative">
        {/* Print button - hidden when printing */}
        <div className="no-print absolute top-4 right-4 z-10 print:hidden">
          <WorkOrderPrintButton workOrderRef={workOrder.work_order_ref} />
        </div>

        {/* Render HTML */}
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  )
}
