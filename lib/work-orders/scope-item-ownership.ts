import type { Database } from '@/lib/supabase/database.types'

type ScopeItemRow = Database['public']['Tables']['scope_items']['Row']

// Shared between the dashboard work-orders editor (client) and the work-order
// print page (server) so both agree on which work order a scope item belongs
// to. See supabase/migrations/20260825_scope_item_work_order_assignment.sql.
//
// A scope item belongs to a work order either because it was explicitly
// claimed into it (assigned_work_order_id), or — the default — because its
// trade string matches that work order's trade label. Explicit assignment
// always wins, so a contractor covering another trade's item can have it
// claimed into their WO without the item's original trade classification
// (used for quoting/margin reporting) ever changing.
//
// `tradeLabel` should be the work order's resolved trade type label
// (trade_name, falling back to the contractor's primary_trade / "Make Safe"
// — see useWorkOrders.ts's tradeTypeLabel) — the same label used everywhere
// else to match a work order to its trade's scope items.
export function resolveOwnedScopeItems(
  wo: { id: string; tradeLabel: string | null },
  allScopeItems: ScopeItemRow[]
): ScopeItemRow[] {
  return allScopeItems.filter(si =>
    si.assigned_work_order_id === wo.id ||
    (si.assigned_work_order_id === null && !!wo.tradeLabel && si.trade === wo.tradeLabel)
  )
}

// An item is unallocated when no work order currently owns it — not
// explicitly assigned, and no work order exists whose trade label matches
// its trade.
export function getUnallocatedScopeItems(
  scopeItems: ScopeItemRow[],
  workOrders: Array<{ quote_id: string | null; tradeTypeLabel: string }>
): ScopeItemRow[] {
  return scopeItems.filter(si => {
    if (!si.trade || si.assigned_work_order_id) return false
    return !workOrders.some(wo => wo.quote_id === si.quote_id && wo.tradeTypeLabel === si.trade)
  })
}
