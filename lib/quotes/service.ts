import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { recomputeAndSaveStage } from '@/lib/jobs/recomputeStage'
import { isPreliminary, preliminaryRate } from '@/lib/quotes/preliminaries'

// Creating and editing quotes and their line items (scope_items): new quote,
// duplicate, quote details and status (approval creates the work orders and
// moves the job's stage), and adding, changing and removing items. Used by
// the quote routes (app/api/quotes) and the voice connector's quote tools.
// The caller checks jobs.edit.

type Client = SupabaseClient<Database>
export type Quote = Database['public']['Tables']['quotes']['Row']
export type ScopeItem = Database['public']['Tables']['scope_items']['Row']
type QuoteUpdate = Database['public']['Tables']['quotes']['Update']
type ScopeItemInsert = Database['public']['Tables']['scope_items']['Insert']
type ScopeItemUpdate = Database['public']['Tables']['scope_items']['Update']

export class QuoteEditError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'QuoteEditError'
  }
}

/** In the order a quote moves through them (the Quotes tab's status order) */
export const QUOTE_STATUSES = ['draft', 'ready', 'sent', 'approved', 'partially_approved', 'rejected'] as const
export const APPROVED_QUOTE_STATUSES = ['approved', 'partially_approved']
const DEFAULT_MARKUP_PCT = 0.19
const DEFAULT_GST_PCT = 0.1

/**
 * A line's rate and total from its quantity and rates. A single rate of
 * exactly 0 with the other still empty means the user hasn't entered the
 * other side yet — the total stays empty rather than $0. Both rates set (even
 * if one is 0) or one non-zero rate is enough.
 */
export function scopeItemTotals(qty: number | null, rateLabour: number | null, rateMaterials: number | null) {
  const ratesReady =
    (rateLabour !== null && rateLabour !== 0) ||
    (rateMaterials !== null && rateMaterials !== 0) ||
    (rateLabour !== null && rateMaterials !== null)
  return {
    rate_total: ratesReady ? (rateLabour ?? 0) + (rateMaterials ?? 0) : null,
    line_total: qty != null && ratesReady ? qty * ((rateLabour ?? 0) + (rateMaterials ?? 0)) : null,
  }
}

async function nextQuoteRef(supabase: Client, tenantId: string, jobId: string, jobNumber: string) {
  const { count } = await supabase
    .from('quotes').select('*', { count: 'exact', head: true })
    .eq('job_id', jobId).eq('tenant_id', tenantId)
  return `Q-${jobNumber}-${(count ?? 0) + 1}`
}

/** A new, empty draft quote on a job, at the insurer's builder's margin. */
export async function createQuote(
  supabase: Client,
  tenantId: string,
  input: { jobId: string; quoteType?: string },
): Promise<Quote> {
  const { data: job, error: jobError } = await supabase
    .from('jobs').select('job_number, client_id')
    .eq('id', input.jobId).eq('tenant_id', tenantId).single()
  if (jobError || !job) throw new QuoteEditError('Job not found', 404)

  let markupPct = DEFAULT_MARKUP_PCT
  if (job.client_id) {
    const { data: client } = await supabase
      .from('clients').select('builders_margin_pct')
      .eq('id', job.client_id).eq('tenant_id', tenantId).single()
    if (client?.builders_margin_pct != null) markupPct = client.builders_margin_pct / 100
  }

  const { data: quote, error } = await supabase
    .from('quotes')
    .insert({
      tenant_id: tenantId, job_id: input.jobId, quote_ref: await nextQuoteRef(supabase, tenantId, input.jobId, job.job_number),
      quote_type: input.quoteType ?? 'additional_works', status: 'draft', is_active_version: true, is_locked: false,
      markup_pct: markupPct, gst_pct: DEFAULT_GST_PCT,
    })
    .select('*').single()
  if (error || !quote) throw new QuoteEditError(error?.message ?? 'Could not create the quote', 500)
  return quote
}

/** A new, independent draft copy of a quote with all its items (the Duplicate button). */
export async function cloneQuote(supabase: Client, tenantId: string, quoteId: string): Promise<Quote> {
  const { data: original, error: quoteError } = await supabase
    .from('quotes').select('*').eq('id', quoteId).eq('tenant_id', tenantId).single()
  if (quoteError || !original) throw new QuoteEditError('Quote not found', 404)

  const { data: scopeItems, error: itemsError } = await supabase
    .from('scope_items').select('*').eq('quote_id', quoteId).eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })
  if (itemsError) throw new QuoteEditError('Failed to fetch scope items', 500)

  let quoteRef = original.quote_ref
  const { data: job } = await supabase
    .from('jobs').select('job_number').eq('id', original.job_id).eq('tenant_id', tenantId).single()
  if (job) quoteRef = await nextQuoteRef(supabase, tenantId, original.job_id, job.job_number)

  const { data: newQuote, error: createError } = await supabase
    .from('quotes')
    .insert({
      tenant_id: original.tenant_id, job_id: original.job_id, inspection_id: original.inspection_id, report_id: original.report_id, quote_ref: quoteRef, quote_type: original.quote_type, version: 1, is_active_version: true, is_locked: false, status: 'draft', approved_amount: original.approved_amount, approval_notes: original.approval_notes, raw_scope_notes: original.raw_scope_notes, total_amount: original.total_amount, markup_pct: original.markup_pct, gst_pct: original.gst_pct, notes: original.notes,
    })
    .select('*').single()
  if (createError || !newQuote) throw new QuoteEditError('Failed to create new quote', 500)

  await insertItemCopies(supabase, newQuote.id, scopeItems ?? [], 0)
  return newQuote
}

async function insertItemCopies(supabase: Client, toQuoteId: string, items: ScopeItem[], sortOffset: number) {
  if (!items.length) return
  const { error } = await supabase.from('scope_items').insert(items.map(item => ({
    tenant_id: item.tenant_id, quote_id: toQuoteId, scope_library_id: item.scope_library_id, room: item.room, room_length: item.room_length, room_width: item.room_width, room_height: item.room_height, trade: item.trade, keyword: item.keyword, item_description: item.item_description, unit: item.unit, qty: item.qty, rate_labour: item.rate_labour, rate_materials: item.rate_materials, rate_total: item.rate_total, line_total: item.line_total, split_type: item.split_type, approval_status: item.approval_status, is_custom: item.is_custom, library_writeback_approved: item.library_writeback_approved, sort_order: (item.sort_order ?? 0) + sortOffset,
  })))
  if (error) throw new QuoteEditError('Failed to clone scope items', 500)
}

/**
 * Copies every item of one quote (any job of the tenant) onto the end of
 * another, as Duplicate does — approval marks reset to pending, as on a new
 * quote. Returns how many were copied.
 */
export async function copyScopeItems(supabase: Client, tenantId: string, fromQuoteId: string, toQuoteId: string): Promise<number> {
  const [{ data: from }, { data: items, error }, { data: last }] = await Promise.all([
    supabase.from('quotes').select('id').eq('id', fromQuoteId).eq('tenant_id', tenantId).maybeSingle(),
    supabase.from('scope_items').select('*').eq('quote_id', fromQuoteId).eq('tenant_id', tenantId).order('sort_order', { ascending: true }),
    supabase.from('scope_items').select('sort_order').eq('quote_id', toQuoteId).eq('tenant_id', tenantId)
      .order('sort_order', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (!from) throw new QuoteEditError('Quote to copy from not found', 404)
  if (error) throw new QuoteEditError('Failed to fetch scope items', 500)
  const copies = (items ?? []).map(i => ({ ...i, approval_status: 'pending' }))
  await insertItemCopies(supabase, toQuoteId, copies, last?.sort_order ?? 0)
  return copies.length
}

/** What can be changed on a quote itself */
export const QUOTE_EDITABLE_FIELDS: (keyof QuoteUpdate)[] = [
  'markup_pct', 'gst_pct', 'status', 'notes', 'is_locked', 'total_amount', 'permit_block_dismissed', 'room_order', 'approval_notes',
]

/**
 * Changes a quote's details. A status change recomputes the job's stage; an
 * approval also creates the job's unplaced work orders from the quote and
 * records the approved amount.
 */
export async function updateQuote(
  supabase: Client,
  tenantId: string,
  quoteId: string,
  updates: Record<string, unknown>,
): Promise<Quote> {
  const safeUpdates: QuoteUpdate = {}
  for (const key of QUOTE_EDITABLE_FIELDS) {
    if (key in updates) (safeUpdates as Record<string, unknown>)[key] = updates[key]
  }

  const { data, error } = await supabase
    .from('quotes').update(safeUpdates).eq('id', quoteId).eq('tenant_id', tenantId).select('*').single()
  if (error || !data) throw new QuoteEditError(error?.message ?? 'Quote not found', error ? 500 : 404)

  if ('status' in safeUpdates && data.job_id) {
    await recomputeAndSaveStage(data.job_id)

    const newStatus = safeUpdates.status as string
    if (APPROVED_QUOTE_STATUSES.includes(newStatus)) {
      await createUnplacedWorkOrdersFromQuote(supabase, data.id, data.job_id, data.tenant_id ?? tenantId)

      // Auto-set approved_amount if not already set
      if (!data.approved_amount) {
        let approvedAmount: number | null = null
        if (newStatus === 'approved') {
          approvedAmount = data.total_amount
        } else {
          const { data: approvedItems } = await supabase
            .from('scope_items').select('line_total')
            .eq('quote_id', quoteId).eq('tenant_id', tenantId).eq('approval_status', 'approved')
          const subtotal = (approvedItems ?? []).reduce((sum, item) => sum + (item.line_total ?? 0), 0)
          approvedAmount = Math.round(subtotal * (1 + (data.markup_pct ?? 0)) * (1 + (data.gst_pct ?? DEFAULT_GST_PCT)) * 100) / 100
        }
        await supabase.from('quotes').update({ approved_amount: approvedAmount }).eq('id', quoteId).eq('tenant_id', tenantId)
        data.approved_amount = approvedAmount
      }
    }
  }
  return data
}

/**
 * Unplaced work orders for each trade in an approved quote. Checks by job (not
 * quote) so it can't double up with another approval or Sync from quote.
 */
async function createUnplacedWorkOrdersFromQuote(supabase: Client, quoteId: string, jobId: string, tenantId: string) {
  const { data: existingWOs } = await supabase
    .from('work_orders').select('id, trade_id, trade_name').eq('job_id', jobId).eq('tenant_id', tenantId)

  const existingTradeIds = new Set((existingWOs ?? []).map(wo => wo.trade_id).filter((id): id is string => id !== null))
  // Unmatched (trade_id=null) work orders by trade_name, so a re-run doesn't duplicate them
  const existingNullTradeNames = new Set(
    (existingWOs ?? []).filter(wo => wo.trade_id === null && wo.trade_name).map(wo => wo.trade_name!.toLowerCase()))

  // Exclude items the insurer explicitly declined; include pending (full approval)
  // and approved (partial approval) items.
  const { data: scopeItems } = await supabase
    .from('scope_items').select('*').eq('quote_id', quoteId).eq('tenant_id', tenantId)
    .or('approval_status.is.null,approval_status.neq.declined')
  if (!scopeItems?.length) {
    console.log(`[Auto-create] No scope items for quote ${quoteId}`)
    return
  }

  const itemsByTrade = new Map<string, typeof scopeItems>()
  for (const item of scopeItems) {
    if (item.trade) itemsByTrade.set(item.trade, [...(itemsByTrade.get(item.trade) ?? []), item])
  }

  // Trade lookup by both primary_trade and business_name (case-insensitive)
  const { data: allTrades } = await supabase.from('trades').select('*').eq('tenant_id', tenantId)
  const tradeMap = new Map<string, string>()
  allTrades?.forEach(trade => {
    if (trade.primary_trade) tradeMap.set(trade.primary_trade.toLowerCase(), trade.id)
    if (trade.business_name) tradeMap.set(trade.business_name.toLowerCase(), trade.id)
  })

  const { data: tradeSequence } = await supabase.from('trade_type_sequence').select('*').eq('tenant_id', tenantId)
  const sequenceMap = new Map<string, number>()
  tradeSequence?.forEach(ts => {
    if (ts.trade_type) sequenceMap.set(ts.trade_type.toLowerCase(), ts.typical_visit_count || 1)
  })

  for (const [tradeName, items] of itemsByTrade) {
    const tradeNameLower = tradeName.toLowerCase()
    const tradeId = tradeMap.get(tradeNameLower) ?? null

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
        tenant_id: tenantId, job_id: jobId, quote_id: quoteId, trade_id: tradeId, trade_name: tradeName, work_type: 'repair', status: 'pending', estimated_hours: totalHours, total_visits: totalVisits, current_visit: 1, gary_state: 'not_started', scope_summary: `${items.length} items`,
      })
      .select('id').single()
    if (woError || !workOrder) {
      console.error(`[Auto-create] Failed to create work order for ${tradeName}:`, woError)
      continue
    }

    for (let visitNum = 1; visitNum <= totalVisits; visitNum++) {
      await supabase.from('work_order_visits').insert({
        tenant_id: tenantId, work_order_id: workOrder.id, job_id: jobId, visit_number: visitNum, estimated_hours: totalHours / totalVisits, status: 'unscheduled',
      })
    }
    console.log(`[Auto-create] Created unplaced work order for ${tradeName}`)
  }
}

/**
 * Why a quote's items can't be changed, or null if they can. The editor is
 * read-only once a quote is locked (Mark as Ready, sent, approved, rejected);
 * Unlock to edit puts it back to draft.
 */
export function quoteItemsLockedReason(quote: Pick<Quote, 'is_locked' | 'status' | 'quote_ref'>): string | null {
  if (!quote.is_locked) return null
  return `${quote.quote_ref ?? 'This quote'} is locked (${quote.status ?? 'no status'}) — unlock it to draft first to change its items.`
}

/** Fields a caller may set on a line; totals are always worked out here */
type ScopeItemFields = Omit<ScopeItemInsert, 'tenant_id' | 'quote_id' | 'id' | 'sort_order' | 'rate_total' | 'line_total' | 'created_at'>

/** Adds a line to the end of a quote (the editor's add row / library pick). */
export async function addScopeItem(
  supabase: Client,
  tenantId: string,
  quoteId: string,
  fields: ScopeItemFields & Record<string, unknown>,
): Promise<ScopeItem> {
  const { room, qty = null, rate_labour = null, rate_materials = null, ...rest } = fields
  // Never let a caller pick the quote, tenant or totals
  const { tenant_id: _t, quote_id: _q, id: _i, sort_order: _s, rate_total: _rt, line_total: _lt, created_at: _c, tenantId: _ct, ...safe } = rest as Record<string, unknown>

  const { data: quote } = await supabase
    .from('quotes').select('id').eq('id', quoteId).eq('tenant_id', tenantId).maybeSingle()
  if (!quote) throw new QuoteEditError('Quote not found', 404)

  const { data: maxSort } = await supabase
    .from('scope_items').select('sort_order')
    .eq('quote_id', quoteId).eq('tenant_id', tenantId)
    .order('sort_order', { ascending: false }).limit(1).maybeSingle()

  const { data, error } = await supabase
    .from('scope_items')
    .insert({
      is_custom: true,
      ...(safe as object),
      tenant_id: tenantId, quote_id: quoteId, room: room ?? null, sort_order: (maxSort?.sort_order ?? 0) + 1,
      qty, rate_labour, rate_materials, ...scopeItemTotals(qty, rate_labour, rate_materials),
    })
    .select('*').single()
  if (error || !data) throw new QuoteEditError(error?.message ?? 'Could not add the item', 500)
  return data
}

/** Changes a line; a new quantity or rate recalculates its total. */
export async function updateScopeItem(
  supabase: Client,
  tenantId: string,
  quoteId: string,
  itemId: string,
  rawUpdates: Record<string, unknown>,
): Promise<ScopeItem> {
  const { tenantId: _ct, tenant_id: _t, quote_id: _q, id: _i, ...rest } = rawUpdates
  const updates = rest as ScopeItemUpdate

  if ('qty' in rest || 'rate_labour' in rest || 'rate_materials' in rest) {
    const { data: current } = await supabase
      .from('scope_items').select('qty, rate_labour, rate_materials')
      .eq('id', itemId).eq('quote_id', quoteId).eq('tenant_id', tenantId).single()
    const pick = (k: 'qty' | 'rate_labour' | 'rate_materials') =>
      k in rest ? (rest[k] as number | null) : (current?.[k] ?? null)
    Object.assign(updates, scopeItemTotals(pick('qty'), pick('rate_labour'), pick('rate_materials')))
  }

  const { data, error } = await supabase
    .from('scope_items').update(updates)
    .eq('id', itemId).eq('quote_id', quoteId).eq('tenant_id', tenantId)
    .select('*').single()
  if (error || !data) {
    console.error('PATCH item error:', error?.message, error?.code, error?.details, error?.hint)
    throw new QuoteEditError(error?.message ?? 'Item not found', error ? 500 : 404)
  }
  return data
}

export async function removeScopeItem(supabase: Client, tenantId: string, quoteId: string, itemId: string): Promise<void> {
  const { error } = await supabase
    .from('scope_items').delete().eq('id', itemId).eq('quote_id', quoteId).eq('tenant_id', tenantId)
  if (error) throw new QuoteEditError(error.message, 500)
}

/**
 * Re-prices the quote's preliminaries from the rest of its items, as the
 * editor does whenever the subtotal changes. Returns the items as saved.
 */
export async function repricePreliminaries(supabase: Client, tenantId: string, quoteId: string): Promise<ScopeItem[]> {
  const { data: items, error } = await supabase
    .from('scope_items').select('*').eq('quote_id', quoteId).eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  const all = items ?? []
  const subtotal = all.filter(i => !isPreliminary(i)).reduce((sum, i) => sum + (i.line_total ?? 0), 0)

  for (const item of all.filter(isPreliminary)) {
    const rate = preliminaryRate(item.preliminary_formula!, subtotal)
    if (rate == null || rate === item.rate_materials) continue
    const lineTotal = item.qty ? item.qty * rate : rate
    const { error: updateErr } = await supabase
      .from('scope_items').update({ rate_materials: rate, line_total: lineTotal })
      .eq('id', item.id).eq('tenant_id', tenantId)
    if (updateErr) throw updateErr
    item.rate_materials = rate
    item.line_total = lineTotal
  }
  return all
}

/**
 * A line's fields taken from a scope library item, as picking it in the
 * editor's description search does.
 */
export async function scopeItemFromLibrary(supabase: Client, tenantId: string, libraryId: string) {
  const { data: lib, error } = await supabase
    .from('scope_library')
    .select('id, trade, keyword, item_description, unit, labour_per_unit, materials_per_unit, trade_rate_total')
    .eq('id', libraryId).eq('tenant_id', tenantId).neq('approval_status', 'archived').maybeSingle()
  if (error) throw error
  if (!lib) throw new QuoteEditError('Library item not found', 404)
  return {
    item_description: lib.item_description ?? '', rate_labour: lib.labour_per_unit, rate_materials: lib.materials_per_unit,
    trade: lib.trade ?? '', keyword: lib.keyword ?? '', unit: lib.unit ?? '', scope_library_id: lib.id,
    is_custom: false, is_reference: false, library_writeback_approved: false, trade_rate_total: lib.trade_rate_total ?? null,
  }
}

/**
 * A line's fields copied from an item on an earlier quote, as picking a
 * reference result does: same description, unit, trade and rates, kept as a
 * fresh custom item.
 */
export async function scopeItemFromEarlierItem(supabase: Client, tenantId: string, itemId: string) {
  const { data: item, error } = await supabase
    .from('scope_items').select('item_description, unit, rate_labour, rate_materials, trade')
    .eq('id', itemId).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw error
  if (!item) throw new QuoteEditError('Earlier item not found', 404)
  return {
    item_description: item.item_description ?? '', rate_labour: item.rate_labour, rate_materials: item.rate_materials,
    trade: item.trade ?? '', keyword: '', unit: item.unit ?? '', scope_library_id: null,
    is_custom: true, is_reference: false, library_writeback_approved: false, trade_rate_total: null,
  }
}

export type QuoteStatusChange =
  | { status: 'draft' | 'ready' | 'approved' }
  | { status: 'partially_approved'; approvedItemIds: string[] }
  | { status: 'rejected'; reason?: string }

/**
 * Moves a quote to a status the way the Quotes tab's buttons do: Mark as
 * Ready locks it, Unlock to edit puts it back to an unlocked draft, approving
 * (fully, or partly with the insurer's chosen items — the rest declined) and
 * rejecting (with the reason) lock it. "Sent" is set by sending the quote.
 */
export async function setQuoteStatus(supabase: Client, tenantId: string, quoteId: string, change: QuoteStatusChange): Promise<Quote> {
  if (change.status === 'partially_approved') {
    const { data: items, error } = await supabase
      .from('scope_items').select('id').eq('quote_id', quoteId).eq('tenant_id', tenantId)
    if (error) throw error
    const approved = new Set(change.approvedItemIds)
    const unknown = change.approvedItemIds.filter(id => !(items ?? []).some(i => i.id === id))
    if (!approved.size || unknown.length) throw new QuoteEditError('Say which of this quote\'s items the insurer approved', 400)
    for (const item of items ?? []) {
      await updateScopeItem(supabase, tenantId, quoteId, item.id, { approval_status: approved.has(item.id) ? 'approved' : 'declined' })
    }
  }
  const updates: Record<string, unknown> = { status: change.status, is_locked: change.status !== 'draft' }
  if (change.status === 'rejected' && change.reason) updates.approval_notes = change.reason
  return updateQuote(supabase, tenantId, quoteId, updates)
}

const LINE_SEARCH_LIMIT = 15
/** ilike treats % and _ as wildcards */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, m => `\\${m}`)

export interface FoundLineItem {
  source: 'quote' | 'library'
  /** scope_items id (quote) or scope_library id (library) */
  id: string
  description: string | null
  unit: string | null
  rate_labour: number | null
  rate_materials: number | null
  trade: string | null
  /** Quote lines only */
  qty?: number | null
  line_total?: number | null
  room?: string | null
  quote_id?: string
  quote_ref?: string | null
  quote_status?: string | null
  job_number?: string | null
  created_at?: string | null
}

/**
 * Lines on the tenant's quotes (newest first) and scope library items whose
 * description contains every word of the query. A job narrows the quote lines
 * to that job's quotes.
 */
export async function findLineItems(
  supabase: Client,
  tenantId: string,
  input: { query: string; jobId?: string; includeLibrary?: boolean; limit?: number },
): Promise<FoundLineItem[]> {
  const words = input.query.trim().split(/\s+/).filter(w => w.length > 1).slice(0, 6)
  if (!words.length) return []
  const limit = input.limit ?? LINE_SEARCH_LIMIT

  let quoteIds: string[] | null = null
  if (input.jobId) {
    const { data: jobQuotes, error } = await supabase
      .from('quotes').select('id').eq('tenant_id', tenantId).eq('job_id', input.jobId)
    if (error) throw error
    quoteIds = (jobQuotes ?? []).map(q => q.id)
    if (!quoteIds.length && !input.includeLibrary) return []
  }

  let itemsQuery = supabase.from('scope_items')
    .select('id, quote_id, item_description, unit, qty, rate_labour, rate_materials, line_total, trade, room, created_at')
    .eq('tenant_id', tenantId)
  for (const w of words) itemsQuery = itemsQuery.ilike('item_description', `%${escapeLike(w)}%`)
  if (quoteIds) itemsQuery = itemsQuery.in('quote_id', quoteIds)

  let libraryQuery = supabase.from('scope_library')
    .select('id, item_description, unit, labour_per_unit, materials_per_unit, trade')
    .eq('tenant_id', tenantId).neq('approval_status', 'archived')
  for (const w of words) libraryQuery = libraryQuery.ilike('item_description', `%${escapeLike(w)}%`)

  const [itemsRes, libraryRes] = await Promise.all([
    quoteIds?.length === 0 ? Promise.resolve({ data: [], error: null }) : itemsQuery.order('created_at', { ascending: false }).limit(limit),
    input.includeLibrary ? libraryQuery.order('item_description').limit(limit) : Promise.resolve({ data: [], error: null }),
  ])
  if (itemsRes.error) throw itemsRes.error
  if (libraryRes.error) throw libraryRes.error

  const items = itemsRes.data ?? []
  const parentIds = [...new Set(items.map(i => i.quote_id).filter((id): id is string => !!id))]
  const { data: quotes, error: quotesErr } = parentIds.length
    ? await supabase.from('quotes').select('id, quote_ref, status, job_id').eq('tenant_id', tenantId).in('id', parentIds)
    : { data: [], error: null }
  if (quotesErr) throw quotesErr
  const jobIds = [...new Set((quotes ?? []).map(q => q.job_id))]
  const { data: jobs, error: jobsErr } = jobIds.length
    ? await supabase.from('jobs').select('id, job_number').eq('tenant_id', tenantId).in('id', jobIds)
    : { data: [], error: null }
  if (jobsErr) throw jobsErr
  const quoteById = new Map((quotes ?? []).map(q => [q.id, q]))
  const jobNumberById = new Map((jobs ?? []).map(j => [j.id, j.job_number]))

  return [
    ...items.map((i): FoundLineItem => {
      const q = i.quote_id ? quoteById.get(i.quote_id) : undefined
      return {
        source: 'quote', id: i.id, description: i.item_description, unit: i.unit, rate_labour: i.rate_labour, rate_materials: i.rate_materials,
        trade: i.trade, qty: i.qty, line_total: i.line_total, room: i.room, quote_id: i.quote_id ?? undefined,
        quote_ref: q?.quote_ref ?? null, quote_status: q?.status ?? null, job_number: q ? jobNumberById.get(q.job_id) ?? null : null,
        created_at: i.created_at,
      }
    }),
    ...(libraryRes.data ?? []).map((l): FoundLineItem => ({
      source: 'library', id: l.id, description: l.item_description, unit: l.unit,
      rate_labour: l.labour_per_unit, rate_materials: l.materials_per_unit, trade: l.trade,
    })),
  ]
}
