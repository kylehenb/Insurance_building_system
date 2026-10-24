import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { resolveOwnedScopeItems } from '@/lib/work-orders/scope-item-ownership'
import { tradeLabelFor } from '@/lib/work-orders/work-order-pdf'
import {
  buildWODisplayItems,
  getAddedItems,
  getDeletedScopeItemIds,
  mergeAddedItem,
  mergeDeletedScopeItemIds,
  mergeItemOverride,
  patchAddedItem,
  removeAddedItem,
  type WODisplayItem,
  type WOItemOverride,
} from '@/app/dashboard/jobs/[jobId]/work-orders/types'

// Creating and changing work orders outside the Work Orders tab: Sync from
// quote (one per trade in the approved quote), adding one for a trade,
// changing its trade / contractor / amount, and its line items. A work
// order's items are the quote's items for its trade, with the work order's
// own changes, additions and removals kept in its notes JSON — the same
// helpers as the tab (work-orders/types.ts), so the tab, the PDF and these
// agree. Used by the work orders route and the voice connector. The caller
// checks jobs.edit.

type Client = SupabaseClient<Database>
export type WorkOrder = Database['public']['Tables']['work_orders']['Row']
type Trade = Database['public']['Tables']['trades']['Row']

export class WorkOrderEditError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'WorkOrderEditError'
  }
}

const APPROVED_STATUSES = ['approved', 'partially_approved']
const round2 = (n: number) => Math.round(n * 100) / 100

export interface SyncFromQuoteResult {
  workOrdersCreated: WorkOrder[]
  tradesInQuote: string[]
  message: string
}

/**
 * Sync from quote: a work order (with its visits) for each trade in the job's
 * approved quote that doesn't have one yet. Items already claimed into a work
 * order are left out, so a trade whose items all moved doesn't get an empty
 * duplicate.
 */
export async function syncWorkOrdersFromQuote(supabase: Client, tenantId: string, jobId: string): Promise<SyncFromQuoteResult> {
  const { data: quote, error: quoteError } = await supabase
    .from('quotes').select('*')
    .eq('job_id', jobId).eq('tenant_id', tenantId).in('status', APPROVED_STATUSES).eq('is_active_version', true)
    .order('created_at', { ascending: false }).limit(1).single()
  if (quoteError || !quote) throw new WorkOrderEditError('No approved quote found for this job', 404)

  // Exclude explicitly declined items
  const { data: scopeItems, error: itemsError } = await supabase
    .from('scope_items').select('*').eq('quote_id', quote.id).eq('tenant_id', tenantId)
    .or('approval_status.is.null,approval_status.neq.declined')
  if (itemsError || !scopeItems?.length) throw new WorkOrderEditError('No scope items found for this quote', 404)

  const itemsByTrade = new Map<string, typeof scopeItems>()
  for (const item of scopeItems) {
    if (item.assigned_work_order_id || !item.trade) continue
    itemsByTrade.set(item.trade, [...(itemsByTrade.get(item.trade) ?? []), item])
  }

  // Trade names → contractors, by primary trade, business name, then specialties
  const { data: allTrades } = await supabase.from('trades').select('*').eq('tenant_id', tenantId)
  const tradeMap = new Map<string, { id: string }>()
  allTrades?.forEach(trade => {
    const entry = { id: trade.id }
    if (trade.primary_trade) tradeMap.set(trade.primary_trade.toLowerCase(), entry)
    if (trade.business_name) tradeMap.set(trade.business_name.toLowerCase(), entry)
    const specialties = (trade as { trade_specialties?: string[] | null }).trade_specialties
    specialties?.forEach(specialty => {
      if (specialty && !tradeMap.has(specialty.toLowerCase())) tradeMap.set(specialty.toLowerCase(), entry)
    })
  })

  const { data: tradeSequence } = await supabase.from('trade_type_sequence').select('*').eq('tenant_id', tenantId)
  const sequenceMap = new Map<string, number>()
  tradeSequence?.forEach(ts => {
    if (ts.trade_type) sequenceMap.set(ts.trade_type.toLowerCase(), ts.typical_visit_count || 1)
  })

  // Existing work orders by job, so this can't double up with the auto-create on approval
  const { data: existingWOs } = await supabase
    .from('work_orders').select('id, trade_id, trade_name, sequence_order, job_id').eq('job_id', jobId).eq('tenant_id', tenantId)

  // Orphans (no trade_id and no trade_name) from old sync code are invisible to the UI: remove them
  const orphanedWOIds = (existingWOs ?? []).filter(wo => wo.trade_id === null && !wo.trade_name).map(wo => wo.id)
  if (orphanedWOIds.length > 0) {
    await supabase.from('work_order_visits').delete().in('work_order_id', orphanedWOIds).eq('tenant_id', tenantId)
    await supabase.from('work_orders').delete().in('id', orphanedWOIds).eq('tenant_id', tenantId)
  }
  const cleanExistingWOs = (existingWOs ?? []).filter(wo => !orphanedWOIds.includes(wo.id))
  const existingTradeIds = new Set(cleanExistingWOs.map(wo => wo.trade_id).filter((id): id is string => id !== null))
  const existingNullTradeNames = new Set(
    cleanExistingWOs.filter(wo => wo.trade_id === null && wo.trade_name).map(wo => wo.trade_name!.toLowerCase()))

  // Start sequence_order after any already-placed work orders
  const maxExistingSeq = Math.max(0, ...cleanExistingWOs.map(wo => wo.sequence_order ?? 0))
  let sequenceOrder = maxExistingSeq > 0 ? maxExistingSeq + 10 : 10
  const workOrdersCreated: WorkOrder[] = []

  for (const [tradeName, items] of itemsByTrade) {
    const tradeNameLower = tradeName.toLowerCase()
    const trade = tradeMap.get(tradeNameLower) ?? null
    if (trade && existingTradeIds.has(trade.id)) continue
    if (!trade && existingNullTradeNames.has(tradeNameLower)) continue

    const totalVisits = sequenceMap.get(tradeNameLower) || 1
    const totalHours = items.reduce((sum, item) => sum + (item.estimated_hours || 0), 0)

    const { data: workOrder, error: woError } = await supabase
      .from('work_orders')
      .insert({
        tenant_id: tenantId, job_id: jobId, quote_id: quote.id, trade_id: trade?.id ?? null, trade_name: tradeName, work_type: 'repair', scope_summary: `${items.length} items`, estimated_hours: totalHours, total_visits: totalVisits, current_visit: 1, sequence_order: sequenceOrder, status: 'pending', gary_state: 'not_started',
      })
      .select('*').single()
    if (woError || !workOrder) {
      console.error('Failed to create work order:', woError)
      continue
    }
    workOrdersCreated.push(workOrder)

    for (let visitNum = 1; visitNum <= totalVisits; visitNum++) {
      const { error: visitError } = await supabase.from('work_order_visits').insert({
        tenant_id: tenantId, work_order_id: workOrder.id, job_id: jobId, visit_number: visitNum, estimated_hours: totalHours / totalVisits, status: 'unscheduled',
      })
      if (visitError) console.error('Failed to create work order visit:', visitError)
    }
    sequenceOrder += 10
  }

  const tradesInQuote = [...itemsByTrade.keys()]
  return {
    workOrdersCreated,
    tradesInQuote,
    message: workOrdersCreated.length > 0
      ? `Created ${workOrdersCreated.length} work order${workOrdersCreated.length === 1 ? '' : 's'} from quote`
      : `No new work orders created — all ${tradesInQuote.length} trade${tradesInQuote.length === 1 ? '' : 's'} in the quote already have work orders`,
  }
}

/** A new unplaced work order for a trade type (the tab's "add work order for trade"). */
export async function createWorkOrder(
  supabase: Client,
  tenantId: string,
  input: { jobId: string; tradeName: string; quoteId?: string | null; tradeId?: string | null },
): Promise<WorkOrder> {
  const { data: job } = await supabase.from('jobs').select('id').eq('id', input.jobId).eq('tenant_id', tenantId).maybeSingle()
  if (!job) throw new WorkOrderEditError('Job not found', 404)
  const { data, error } = await supabase
    .from('work_orders')
    .insert({
      tenant_id: tenantId, job_id: input.jobId, quote_id: input.quoteId ?? null, trade_name: input.tradeName, trade_id: input.tradeId ?? null,
      work_type: 'repair', status: 'pending', gary_state: 'not_started', total_visits: 1, current_visit: 1,
    })
    .select('*').single()
  if (error || !data) throw new WorkOrderEditError(error?.message ?? 'Could not create the work order', 500)
  return data
}

/** What can be changed on a work order itself, as on the tab */
export interface WorkOrderDetailsUpdate {
  /** Trade type label, e.g. "Plasterer" — decides which quote items it has */
  trade_name?: string
  /** The contractor (trades row) doing it */
  trade_id?: string | null
  /** The amount the trade is paid, overriding the items total; null to go back to the items */
  agreed_amount?: number | null
  trade_cost?: number | null
  estimated_hours?: number | null
}

export async function updateWorkOrder(supabase: Client, tenantId: string, workOrderId: string, updates: WorkOrderDetailsUpdate): Promise<WorkOrder> {
  const patch: Database['public']['Tables']['work_orders']['Update'] = {}
  for (const k of ['trade_name', 'trade_id', 'agreed_amount', 'trade_cost', 'estimated_hours'] as const) {
    if (k in updates) (patch as Record<string, unknown>)[k] = updates[k]
  }
  if (patch.trade_id) {
    const { data: trade } = await supabase.from('trades').select('id').eq('id', patch.trade_id).eq('tenant_id', tenantId).maybeSingle()
    if (!trade) throw new WorkOrderEditError('Contractor not found', 404)
  }
  const { data, error } = await supabase
    .from('work_orders').update(patch).eq('id', workOrderId).eq('tenant_id', tenantId).select('*').maybeSingle()
  if (error) throw new WorkOrderEditError(error.message, 500)
  if (!data) throw new WorkOrderEditError('Work order not found', 404)
  return data
}

export interface WorkOrderItems {
  workOrder: WorkOrder
  trade: Trade | null
  tradeLabel: string
  /** The quote's items and the work order's own, with its changes applied (removed ones flagged) */
  items: WODisplayItem[]
  /** Sum of the items not removed */
  itemsTotal: number
}

/** A work order with its items as the tab and PDF show them. */
export async function loadWorkOrderItems(supabase: Client, tenantId: string, workOrderId: string): Promise<WorkOrderItems> {
  const { data: workOrder, error } = await supabase.from('work_orders').select('*').eq('id', workOrderId).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw new WorkOrderEditError(error.message, 500)
  if (!workOrder) throw new WorkOrderEditError('Work order not found', 404)
  const [tradeRes, scopeRes] = await Promise.all([
    workOrder.trade_id
      ? supabase.from('trades').select('*').eq('id', workOrder.trade_id).eq('tenant_id', tenantId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    workOrder.quote_id
      ? supabase.from('scope_items').select('*').eq('quote_id', workOrder.quote_id).eq('tenant_id', tenantId).order('sort_order', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ])
  if (tradeRes.error) throw new WorkOrderEditError(tradeRes.error.message, 500)
  if (scopeRes.error) throw new WorkOrderEditError(scopeRes.error.message, 500)
  const trade = tradeRes.data
  const tradeLabel = tradeLabelFor(workOrder, trade)
  const owned = resolveOwnedScopeItems({ id: workOrder.id, tradeLabel: tradeLabel || null }, scopeRes.data ?? [])
  const { woDisplayItems, lineItemsTotal } = buildWODisplayItems(owned, workOrder.notes)
  return { workOrder, trade, tradeLabel, items: woDisplayItems, itemsTotal: round2(lineItemsTotal) }
}

export interface WorkOrderItemFields {
  item_description?: string
  room?: string | null
  qty?: number
  rate_labour?: number
  rate_materials?: number
}

const lineTotal = (qty: number, rateLabour: number, rateMaterials: number) => round2(qty * (rateLabour + rateMaterials))

async function saveNotes(supabase: Client, tenantId: string, workOrderId: string, notes: string) {
  const { error } = await supabase.from('work_orders').update({ notes }).eq('id', workOrderId).eq('tenant_id', tenantId)
  if (error) throw new WorkOrderEditError(error.message, 500)
}

/** Adds an item to the work order only (the quote is unchanged). Returns its id. */
export async function addWorkOrderItem(supabase: Client, tenantId: string, workOrderId: string, fields: WorkOrderItemFields): Promise<string> {
  if (!fields.item_description) throw new WorkOrderEditError('The item needs a description', 400)
  const { workOrder, tradeLabel } = await loadWorkOrderItems(supabase, tenantId, workOrderId)
  const qty = fields.qty ?? 1
  const rateLabour = fields.rate_labour ?? 0
  const rateMaterials = fields.rate_materials ?? 0
  const id = crypto.randomUUID()
  await saveNotes(supabase, tenantId, workOrderId, mergeAddedItem(workOrder.notes, {
    id, item_description: fields.item_description, qty, rate_labour: rateLabour, rate_materials: rateMaterials,
    line_total: lineTotal(qty, rateLabour, rateMaterials), room: fields.room ?? null, trade: tradeLabel || null,
  }))
  return id
}

/**
 * Changes an item for this work order only: an item it added is changed in
 * place; a quote item gets an override (the quote itself is unchanged). A new
 * quantity or rate recalculates its total.
 */
export async function updateWorkOrderItem(
  supabase: Client,
  tenantId: string,
  workOrderId: string,
  itemId: string,
  fields: WorkOrderItemFields,
): Promise<void> {
  const { workOrder, items } = await loadWorkOrderItems(supabase, tenantId, workOrderId)
  const item = items.find(i => i.id === itemId)
  if (!item) throw new WorkOrderEditError('Item not found on this work order', 404)

  const qty = fields.qty ?? item.qty
  const rateLabour = fields.rate_labour ?? item.rate_labour
  const rateMaterials = fields.rate_materials ?? item.rate_materials
  const repriced = 'qty' in fields || 'rate_labour' in fields || 'rate_materials' in fields

  let notes: string
  if (item.isAddedInWO) {
    notes = patchAddedItem(workOrder.notes, itemId, {
      ...('item_description' in fields ? { item_description: fields.item_description ?? '' } : {}),
      ...('room' in fields ? { room: fields.room ?? null } : {}),
      ...(repriced ? { qty, rate_labour: rateLabour, rate_materials: rateMaterials, line_total: lineTotal(qty, rateLabour, rateMaterials) } : {}),
    })
  } else {
    // The tab doesn't move quote items between rooms from a work order
    const override: WOItemOverride = {
      ...('item_description' in fields ? { item_description: fields.item_description ?? null } : {}),
      ...(repriced ? { qty, rate_labour: rateLabour, rate_materials: rateMaterials, line_total: lineTotal(qty, rateLabour, rateMaterials) } : {}),
    }
    if (!Object.keys(override).length) throw new WorkOrderEditError('A quote item\'s room can\'t be changed from the work order', 400)
    notes = mergeItemOverride(workOrder.notes, itemId, override)
  }
  await saveNotes(supabase, tenantId, workOrderId, notes)
}

/**
 * Takes an item off the work order: one it added is removed for good; a
 * quote item is marked removed (restoreWorkOrderItem puts it back).
 */
export async function removeWorkOrderItem(supabase: Client, tenantId: string, workOrderId: string, itemId: string): Promise<void> {
  const { workOrder, items } = await loadWorkOrderItems(supabase, tenantId, workOrderId)
  if (!items.some(i => i.id === itemId)) throw new WorkOrderEditError('Item not found on this work order', 404)
  const notes = getAddedItems(workOrder.notes).some(a => a.id === itemId)
    ? removeAddedItem(workOrder.notes, itemId)
    : mergeDeletedScopeItemIds(workOrder.notes, [...new Set([...getDeletedScopeItemIds(workOrder.notes), itemId])])
  await saveNotes(supabase, tenantId, workOrderId, notes)
}

/** Puts a removed quote item back on the work order. */
export async function restoreWorkOrderItem(supabase: Client, tenantId: string, workOrderId: string, itemId: string): Promise<void> {
  const { workOrder } = await loadWorkOrderItems(supabase, tenantId, workOrderId)
  const deleted = getDeletedScopeItemIds(workOrder.notes)
  if (!deleted.includes(itemId)) throw new WorkOrderEditError('That item wasn\'t removed', 400)
  await saveNotes(supabase, tenantId, workOrderId, mergeDeletedScopeItemIds(workOrder.notes, deleted.filter(id => id !== itemId)))
}
