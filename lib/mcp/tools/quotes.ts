import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { money, spokenDate } from '@/lib/mcp/tools/work-orders'
import { isToolResult, jobFromArgs } from '@/lib/mcp/tools/excess'
import { quoteDocumentTotal } from '@/lib/documents/send/documents'
import {
  QuoteEditError,
  addScopeItem,
  copyScopeItems,
  createQuote,
  findLineItems,
  quoteItemsLockedReason,
  removeScopeItem,
  repricePreliminaries,
  scopeItemFromEarlierItem,
  scopeItemFromLibrary,
  setQuoteStatus,
  updateQuote,
  updateScopeItem,
  type FoundLineItem,
  type Quote,
  type QuoteStatusChange,
  type ScopeItem,
} from '@/lib/quotes/service'

// Quotes by voice: reading a quote's line items, finding lines on earlier
// quotes (and the scope library) to reuse, creating a quote and changing it.
// Everything goes through lib/quotes/service.ts — the same functions as the
// quote editor's routes — so totals, preliminaries, approval side effects
// (work orders, stage) and the "locked quotes can't be edited" rule match the
// app.

/** Items spoken per room before "and N more" (the data has them all) */
const MAX_ITEMS_IN_TEXT = 60

const round2 = (n: number) => Math.round(n * 100) / 100
const amount = (n: number | null | undefined) => (n == null ? 'no price' : money(round2(n)))
const pct = (n: number | null | undefined) => (n == null ? '—' : `${round2(n * 100)}%`)

/** A line as the quote PDF prices it: qty × rates, or the stored total if it has no rates */
const effectiveTotal = (item: ScopeItem) =>
  item.qty == null || (item.rate_labour == null && item.rate_materials == null)
    ? item.line_total ?? 0
    : item.qty * ((item.rate_labour ?? 0) + (item.rate_materials ?? 0))

export interface QuoteLine {
  item_id: string
  room: string | null
  description: string | null
  qty: number | null
  unit: string | null
  rate_labour: number | null
  rate_materials: number | null
  line_total: number | null
  trade: string | null
  approval_status: string | null
  from_library: boolean
}

const asLine = (i: ScopeItem): QuoteLine => ({
  item_id: i.id, room: i.room, description: i.item_description, qty: i.qty, unit: i.unit,
  rate_labour: i.rate_labour, rate_materials: i.rate_materials, line_total: i.line_total,
  trade: i.trade, approval_status: i.approval_status, from_library: !!i.scope_library_id,
})

function describeLine(i: ScopeItem): string {
  const rate = (i.rate_labour ?? 0) + (i.rate_materials ?? 0)
  const qty = i.qty != null ? `${i.qty}${i.unit ? ` ${i.unit}` : ''} × ${money(round2(rate))} = ` : ''
  const extras = [i.trade, i.approval_status === 'declined' ? 'declined' : null].filter(Boolean).join(', ')
  return `- ${i.item_description?.trim() || '(no description)'}: ${qty}${amount(i.line_total)}${extras ? ` (${extras})` : ''}`
}

/** Rooms in the quote's own order (room_order), then any others as they come */
function byRoom(quote: Quote, items: ScopeItem[]): [string, ScopeItem[]][] {
  const rooms = new Map<string, ScopeItem[]>()
  for (const i of [...items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
    const room = i.room?.trim() || 'Unassigned'
    rooms.set(room, [...(rooms.get(room) ?? []), i])
  }
  const order = new Map((quote.room_order ?? []).map((r, idx) => [r, idx]))
  return [...rooms].sort(([a], [b]) => (order.get(a) ?? 999) - (order.get(b) ?? 999))
}

export interface QuoteView {
  quote_id: string
  quote_ref: string | null
  job_number: string | null
  property_address: string | null
  status: string | null
  locked: boolean
  builders_margin_pct: number | null
  gst_pct: number | null
  subtotal: number
  total_inc_gst: number
  approved_amount: number | null
  notes: string | null
  approval_notes: string | null
  item_count: number
  items: QuoteLine[]
}

/** A quote and its items (this tenant's), or null. */
async function loadQuote(quoteId: string, ctx: McpContext) {
  const { supabase, tenantId } = ctx
  const { data: quote, error } = await supabase.from('quotes').select('*').eq('tenant_id', tenantId).eq('id', quoteId).maybeSingle()
  if (error) throw error
  if (!quote) return null
  const [itemsRes, jobRes] = await Promise.all([
    supabase.from('scope_items').select('*').eq('tenant_id', tenantId).eq('quote_id', quoteId).order('sort_order', { ascending: true }),
    supabase.from('jobs').select('job_number, property_address').eq('tenant_id', tenantId).eq('id', quote.job_id).maybeSingle(),
  ])
  if (itemsRes.error) throw itemsRes.error
  if (jobRes.error) throw jobRes.error
  return { quote, items: itemsRes.data ?? [], job: jobRes.data }
}

function quoteView(loaded: NonNullable<Awaited<ReturnType<typeof loadQuote>>>): QuoteView {
  const { quote, items, job } = loaded
  return {
    quote_id: quote.id,
    quote_ref: quote.quote_ref,
    job_number: job?.job_number ?? null,
    property_address: job?.property_address ?? null,
    status: quote.status,
    locked: !!quote.is_locked,
    builders_margin_pct: quote.markup_pct,
    gst_pct: quote.gst_pct,
    subtotal: round2(items.reduce((s, i) => s + effectiveTotal(i), 0)),
    total_inc_gst: round2(quoteDocumentTotal(quote, items)),
    approved_amount: quote.approved_amount,
    notes: quote.notes,
    approval_notes: quote.approval_notes,
    item_count: items.length,
    items: items.map(asLine),
  }
}

const headline = (v: QuoteView) =>
  `${v.quote_ref ?? 'Quote'} on ${v.job_number ?? 'unknown job'}: ${v.status ?? 'no status'}${v.locked ? ', locked' : ''}. ` +
  `${v.item_count} item${v.item_count === 1 ? '' : 's'}, subtotal ${money(v.subtotal)}, builder's margin ${pct(v.builders_margin_pct)}, ` +
  `total ${money(v.total_inc_gst)} inc GST${v.approved_amount ? ` (approved amount ${money(v.approved_amount)})` : ''}.`

function quoteNotFound(): McpToolResult {
  return { text: 'No such quote — use get_quote with the job number to list its quotes.', isError: true }
}

function errorResult(err: unknown): McpToolResult {
  if (err instanceof QuoteEditError) return { text: err.message, data: { status: err.status }, isError: true }
  throw err
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export const getQuote: McpTool = {
  name: 'get_quote',
  title: 'Get quote',
  description: [
    'Reads a quote\'s line items (scope items) room by room — description, quantity, unit, labour and materials rates, line total, trade, and whether the insurer declined it —',
    'with its status, whether it\'s locked, builder\'s margin, subtotal and total inc GST.',
    'Give quote_id (from list_job_documents, find_line_items or an earlier call), or just job_number to list that job\'s current quotes with their totals and pick one.',
    'Each item has an item_id for edit_quote_items.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      quote_id: { type: 'string', description: 'The quote to read.' },
      job_number: { type: 'string', description: 'Job number, e.g. IRC1001 — lists its quotes when no quote_id is given.' },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const quoteId = str(args.quote_id)
    if (!quoteId) {
      if (!str(args.job_number)) return { text: 'Which quote, or which job?', isError: true }
      const job = await jobFromArgs(args, ctx)
      if (isToolResult(job)) return job
      const { data: quotes, error } = await ctx.supabase
        .from('quotes').select('*').eq('tenant_id', ctx.tenantId).eq('job_id', job.id).eq('is_active_version', true)
        .order('created_at', { ascending: true })
      if (error) throw error
      if (!quotes?.length) return { text: `${job.job_number} has no quotes.`, data: { job_number: job.job_number, quotes: [] } }
      const { data: items, error: itemsErr } = await ctx.supabase
        .from('scope_items').select('*').eq('tenant_id', ctx.tenantId).in('quote_id', quotes.map(q => q.id))
      if (itemsErr) throw itemsErr
      const views = quotes.map(q => quoteView({ quote: q, items: (items ?? []).filter(i => i.quote_id === q.id), job }))
      if (views.length === 1) return getQuote.run({ quote_id: views[0].quote_id }, ctx)
      return {
        text: [
          `${job.job_number} has ${views.length} quotes — which one?`,
          ...views.map((v, idx) => `- ${headline(v)}${quotes[idx].created_at ? ` Created ${spokenDate(quotes[idx].created_at!)}.` : ''}`),
        ].join('\n'),
        data: { job_number: job.job_number, quotes: views.map(({ items: _items, ...v }) => v) },
      }
    }

    const loaded = await loadQuote(quoteId, ctx)
    if (!loaded) return quoteNotFound()
    const view = quoteView(loaded)
    const lines: string[] = []
    let shown = 0
    for (const [room, items] of byRoom(loaded.quote, loaded.items)) {
      if (shown >= MAX_ITEMS_IN_TEXT) break
      const roomItems = items.slice(0, MAX_ITEMS_IN_TEXT - shown)
      shown += roomItems.length
      lines.push(`${room}:`, ...roomItems.map(describeLine))
    }
    const rest = view.item_count - shown
    return {
      text: [
        headline(view),
        ...(view.notes?.trim() ? [`Notes: ${view.notes.trim()}`] : []),
        ...(view.approval_notes?.trim() ? [`Approval notes: ${view.approval_notes.trim()}`] : []),
        ...(lines.length ? lines : ['No items yet.']),
        ...(rest > 0 ? [`…and ${rest} more items (all are in the data).`] : []),
      ].join('\n'),
      data: { quote: view },
    }
  },
}

function describeFound(f: FoundLineItem): string {
  const rate = (f.rate_labour ?? 0) + (f.rate_materials ?? 0)
  const per = `${money(round2(rate))}${f.unit ? ` per ${f.unit}` : ''}`
  if (f.source === 'library') return `- Library: ${f.description ?? '(no description)'}, ${per}${f.trade ? ` (${f.trade})` : ''}`
  const where = [f.job_number, f.quote_ref].filter(Boolean).join(' ')
  return `- ${where || 'Quote'}${f.created_at ? `, ${spokenDate(f.created_at)}` : ''}: ${f.description ?? '(no description)'}, ` +
    `${f.qty ?? '?'}${f.unit ? ` ${f.unit}` : ''} at ${per} = ${amount(f.line_total)}${f.trade ? ` (${f.trade})` : ''}`
}

export const findLineItemsTool: McpTool = {
  name: 'find_line_items',
  title: 'Find line items',
  description: [
    'Searches the line items on earlier quotes (newest first) by words in the description, e.g. "gyprock ceiling" or "downpipe", to see what was quoted and at what rates —',
    'optionally only on one job, and optionally in the scope library (the standard rates) too.',
    'Use it to look up what was charged before, or to find a line to reuse: pass a quote line\'s id as copy_from_item_id, or a library item\'s id as library_item_id, when adding items with edit_quote_items or create_quote.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Words in the item description. Every word must match.' },
      job_number: { type: 'string', description: 'Only this job\'s quotes.' },
      include_library: { type: 'boolean', description: 'Also search the scope library (standard items and rates).' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const query = str(args.query)
    if (!query) return { text: 'What should I search for?', isError: true }
    let jobId: string | undefined
    let jobNumber: string | undefined
    if (str(args.job_number)) {
      const job = await jobFromArgs(args, ctx)
      if (isToolResult(job)) return job
      jobId = job.id
      jobNumber = job.job_number
    }
    const found = await findLineItems(ctx.supabase, ctx.tenantId, { query, jobId, includeLibrary: args.include_library === true })
    const where = jobNumber ? ` on ${jobNumber}'s quotes` : ''
    if (!found.length) return { text: `No line items matching "${query}"${where}${args.include_library === true ? ' or in the library' : ''}.`, data: { items: [] } }
    return {
      text: [`${found.length} line item${found.length === 1 ? '' : 's'} matching "${query}"${where}:`, ...found.map(describeFound)].join('\n'),
      data: { items: found },
    }
  },
}

const ITEM_FIELDS = {
  room: { type: 'string', description: 'Room or area heading, e.g. "Kitchen", "Roof", "Preliminaries".' },
  description: { type: 'string', description: 'What the work is, as it appears on the quote.' },
  qty: { type: 'number' },
  unit: { type: 'string', description: 'e.g. m2, lm, each, item, hr.' },
  rate_labour: { type: 'number', description: 'Labour rate per unit, ex GST.' },
  rate_materials: { type: 'number', description: 'Materials rate per unit, ex GST.' },
  trade: { type: 'string', description: 'Trade that does it, e.g. Plasterer — this is what work orders are made from.' },
}

const NEW_ITEMS_SCHEMA = {
  type: 'array',
  maxItems: 40,
  description: 'Lines to add. Give a room and either a description with qty and rates, or library_item_id / copy_from_item_id (from find_line_items) to take the description, unit, trade and rates from there — then give qty, and any field you give overrides the copied one.',
  items: {
    type: 'object',
    properties: {
      ...ITEM_FIELDS,
      library_item_id: { type: 'string', description: 'A scope library item to use (find_line_items with include_library), at the rates for this quote\'s insurer, with the qty filled into its wording.' },
      copy_from_item_id: { type: 'string', description: 'A line on an earlier quote to copy (find_line_items or get_quote).' },
    },
    required: ['room'],
    additionalProperties: false,
  },
}

/** The editor's field names from the tool's */
function itemFields(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (str(input.room)) out.room = str(input.room)
  if (typeof input.description === 'string') out.item_description = input.description.trim()
  if (typeof input.unit === 'string') out.unit = input.unit.trim()
  if (typeof input.trade === 'string') out.trade = input.trade.trim()
  for (const k of ['qty', 'rate_labour', 'rate_materials'] as const) if (num(input[k]) !== undefined) out[k] = num(input[k])
  return out
}

/** Adds lines to a quote; stops at the first one that fails and says how far it got. */
async function addItems(quoteId: string, inputs: Record<string, unknown>[], ctx: McpContext): Promise<{ added: ScopeItem[]; error?: string }> {
  const added: ScopeItem[] = []
  for (const [idx, input] of inputs.entries()) {
    try {
      const own = itemFields(input)
      if (!own.room) throw new QuoteEditError(`Item ${idx + 1} needs a room`, 400)
      const base: Record<string, unknown> = str(input.library_item_id)
        ? await scopeItemFromLibrary(ctx.supabase, ctx.tenantId, str(input.library_item_id)!, { quoteId, qty: own.qty as number | undefined })
        : str(input.copy_from_item_id)
          ? await scopeItemFromEarlierItem(ctx.supabase, ctx.tenantId, str(input.copy_from_item_id)!)
          : {}
      const fields: Record<string, unknown> = { ...base, ...own }
      // A description of your own makes it a custom line, as typing over a library pick does
      if ('scope_library_id' in base && base.scope_library_id && 'item_description' in own) Object.assign(fields, { scope_library_id: null, is_custom: true })
      if (!fields.item_description) throw new QuoteEditError(`Item ${idx + 1} needs a description`, 400)
      added.push(await addScopeItem(ctx.supabase, ctx.tenantId, quoteId, fields as Parameters<typeof addScopeItem>[3]))
    } catch (err) {
      if (err instanceof QuoteEditError) return { added, error: `Item ${idx + 1} (${str(input.description) ?? 'no description'}) wasn't added: ${err.message}.` }
      throw err
    }
  }
  return { added }
}

/** Counts a job's work orders, to say how many an approval created */
async function workOrderTrades(jobId: string, ctx: McpContext) {
  const { data, error } = await ctx.supabase.from('work_orders').select('id, trade_name').eq('tenant_id', ctx.tenantId).eq('job_id', jobId)
  if (error) throw error
  return data ?? []
}

export const createQuoteTool: McpTool = {
  name: 'create_quote',
  title: 'Create quote',
  description: [
    'Creates a new draft quote on a job (at the insurer\'s builder\'s margin), like New quote on the Quotes tab, and optionally fills it:',
    'copy_items_from_quote_id copies every line of an earlier quote (any job) onto it, and items adds lines.',
    'Check list_job_documents or get_quote first — if the job already has a draft quote the user may mean to change that one instead.',
    'Read back the job and what will go on it, and get a clear yes first.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      job_number: { type: 'string', description: 'Job number, e.g. IRC1001.' },
      copy_items_from_quote_id: { type: 'string', description: 'Copy all lines from this quote.' },
      items: NEW_ITEMS_SCHEMA,
      notes: { type: 'string', description: 'Notes shown on the quote.' },
    },
    required: ['job_number'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  permission: 'jobs.edit',

  async run(args, ctx): Promise<McpToolResult> {
    const job = await jobFromArgs(args, ctx)
    if (isToolResult(job)) return job
    const items = Array.isArray(args.items) ? args.items as Record<string, unknown>[] : []

    let quote: Quote
    try {
      quote = await createQuote(ctx.supabase, ctx.tenantId, { jobId: job.id })
      if (str(args.notes)) quote = await updateQuote(ctx.supabase, ctx.tenantId, quote.id, { notes: str(args.notes) })
    } catch (err) {
      return errorResult(err)
    }

    const problems: string[] = []
    let copied = 0
    if (str(args.copy_items_from_quote_id)) {
      try {
        copied = await copyScopeItems(ctx.supabase, ctx.tenantId, str(args.copy_items_from_quote_id)!, quote.id)
      } catch (err) {
        if (!(err instanceof QuoteEditError)) throw err
        problems.push(`Lines weren't copied: ${err.message}.`)
      }
    }
    const { added, error } = await addItems(quote.id, items, ctx)
    if (error) problems.push(error)
    if (copied || added.length) await repricePreliminaries(ctx.supabase, ctx.tenantId, quote.id)

    const loaded = await loadQuote(quote.id, ctx)
    const view = loaded ? quoteView(loaded) : null
    const filled = [copied ? `copied ${copied} lines` : null, added.length ? `added ${added.length}` : null].filter(Boolean).join(' and ')
    return {
      text: [
        `Created ${quote.quote_ref} on ${job.job_number} as a draft${filled ? ` and ${filled}` : ''}.`,
        ...(view ? [`Total now ${money(view.total_inc_gst)} inc GST (${view.item_count} items).`] : []),
        ...problems,
      ].join(' '),
      data: { quote: view, ...(problems.length ? { problems } : {}) },
    }
  },
}

const QUOTE_STATUS_ENUM = ['draft', 'ready', 'approved', 'partially_approved', 'rejected']

export const updateQuoteTool: McpTool = {
  name: 'update_quote',
  title: 'Update quote',
  description: [
    'Changes a quote\'s notes or builder\'s margin, and/or moves its status as the Quotes tab\'s buttons do:',
    '"ready" (Mark as Ready — locks it), "draft" (Unlock to edit), "approved" (the insurer approved it all), "partially_approved" (give approved_item_ids — every other item is declined), "rejected" (give a reason).',
    'Approving locks the quote, records the approved amount, creates the job\'s work orders from it and updates the job\'s stage. "Sent" happens by sending it with send_documents.',
    'A locked quote\'s margin and notes can only be changed after unlocking (status "draft").',
    'Read back the change and get a clear yes first.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      quote_id: { type: 'string' },
      status: { type: 'string', enum: QUOTE_STATUS_ENUM },
      approved_item_ids: { type: 'array', items: { type: 'string' }, description: 'partially_approved only: the item_ids the insurer approved (from get_quote).' },
      reason: { type: 'string', description: 'rejected only: why, e.g. "Claim denied by insurer", "Claim cancelled", "New quote required".' },
      notes: { type: 'string', description: 'Replaces the quote\'s notes.' },
      builders_margin_pct: { type: 'number', description: 'Builder\'s margin as a percentage, e.g. 19 for 19%.' },
    },
    required: ['quote_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  permission: 'jobs.edit',

  async run(args, ctx): Promise<McpToolResult> {
    const quoteId = str(args.quote_id) ?? ''
    const loaded = await loadQuote(quoteId, ctx)
    if (!loaded) return quoteNotFound()
    const { quote } = loaded

    const status = typeof args.status === 'string' ? args.status : undefined
    if (status && !QUOTE_STATUS_ENUM.includes(status)) return { text: `Status must be one of ${QUOTE_STATUS_ENUM.join(', ')}.`, isError: true }
    const details: Record<string, unknown> = {}
    if (typeof args.notes === 'string') details.notes = args.notes.trim() || null
    if (num(args.builders_margin_pct) !== undefined) {
      const margin = num(args.builders_margin_pct)!
      if (margin < 0 || margin > 100) return { text: 'The builder\'s margin should be a percentage between 0 and 100.', isError: true }
      details.markup_pct = round2(margin) / 100
    }
    if (!status && !Object.keys(details).length) return { text: 'What should change on the quote?', isError: true }
    if (Object.keys(details).length && quote.is_locked && status !== 'draft') {
      return { text: `${quote.quote_ref ?? 'This quote'} is locked (${quote.status}) — unlock it to draft first to change its margin or notes.`, isError: true }
    }

    let change: QuoteStatusChange | null = null
    if (status === 'partially_approved') {
      const ids = Array.isArray(args.approved_item_ids) ? args.approved_item_ids.filter((x): x is string => typeof x === 'string') : []
      if (!ids.length) return { text: 'Which items did the insurer approve? Give their item_ids from get_quote.', isError: true }
      change = { status, approvedItemIds: ids }
    } else if (status === 'rejected') {
      change = { status, reason: str(args.reason) }
    } else if (status) {
      change = { status: status as 'draft' | 'ready' | 'approved' }
    }

    const before = change && change.status.includes('approved') ? await workOrderTrades(quote.job_id, ctx) : []
    try {
      // Unlock before editing; otherwise edit, then lock
      if (change?.status === 'draft') await setQuoteStatus(ctx.supabase, ctx.tenantId, quoteId, change)
      if (Object.keys(details).length) await updateQuote(ctx.supabase, ctx.tenantId, quoteId, details)
      if (change && change.status !== 'draft') await setQuoteStatus(ctx.supabase, ctx.tenantId, quoteId, change)
    } catch (err) {
      return errorResult(err)
    }

    const after = await loadQuote(quoteId, ctx)
    const view = after ? quoteView(after) : null
    const done: string[] = []
    if ('markup_pct' in details) done.push(`builder's margin set to ${pct(details.markup_pct as number)}`)
    if ('notes' in details) done.push(details.notes ? 'notes updated' : 'notes cleared')
    if (change) done.push(`marked ${change.status.replace('_', ' ')}${change.status === 'rejected' && change.reason ? ` (${change.reason})` : ''}`)
    const extra: string[] = []
    if (change?.status.includes('approved')) {
      const now = await workOrderTrades(quote.job_id, ctx)
      const made = now.filter(w => !before.some(b => b.id === w.id))
      extra.push(made.length
        ? `Created ${made.length} work order${made.length === 1 ? '' : 's'}: ${made.map(w => w.trade_name ?? 'unnamed trade').join(', ')}.`
        : 'No new work orders were needed — every trade on it already has one.')
      if (view?.approved_amount) extra.push(`Approved amount ${money(view.approved_amount)}.`)
    }
    return {
      text: [`${quote.quote_ref ?? 'Quote'}: ${done.join(', ')}.`, ...(view ? [`Total ${money(view.total_inc_gst)} inc GST.`] : []), ...extra].join(' '),
      data: { quote: view ? { ...view, items: undefined } : null },
    }
  },
}

export const editQuoteItems: McpTool = {
  name: 'edit_quote_items',
  title: 'Edit quote items',
  description: [
    'Adds, changes and removes line items on a quote, like the quote editor: totals are worked out from qty × (labour + materials), and the preliminaries (insurance, levies) are re-priced.',
    'Get item_ids from get_quote. Lines can be taken from the scope library or copied from an earlier quote (find_line_items).',
    'Only unlocked (draft) quotes can be edited — unlock with update_quote status "draft" first if the user wants to.',
    'Read back the changes and get a clear yes first; removing a line can\'t be undone.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      quote_id: { type: 'string' },
      add: NEW_ITEMS_SCHEMA,
      update: {
        type: 'array',
        maxItems: 40,
        description: 'Changes to existing lines; only the fields given change.',
        items: {
          type: 'object',
          properties: { item_id: { type: 'string' }, ...ITEM_FIELDS },
          required: ['item_id'],
          additionalProperties: false,
        },
      },
      remove: { type: 'array', maxItems: 40, items: { type: 'string' }, description: 'item_ids of lines to remove.' },
    },
    required: ['quote_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  permission: 'jobs.edit',

  async run(args, ctx): Promise<McpToolResult> {
    const quoteId = str(args.quote_id) ?? ''
    const loaded = await loadQuote(quoteId, ctx)
    if (!loaded) return quoteNotFound()
    const locked = quoteItemsLockedReason(loaded.quote)
    if (locked) return { text: locked, isError: true }

    const adds = Array.isArray(args.add) ? args.add as Record<string, unknown>[] : []
    const updates = Array.isArray(args.update) ? args.update as Record<string, unknown>[] : []
    const removes = Array.isArray(args.remove) ? args.remove.filter((x): x is string => typeof x === 'string') : []
    if (!adds.length && !updates.length && !removes.length) return { text: 'What should change? Give items to add, update or remove.', isError: true }

    const onQuote = new Map(loaded.items.map(i => [i.id, i]))
    const unknown = [...updates.map(u => String(u.item_id)), ...removes].filter(id => !onQuote.has(id))
    if (unknown.length) return { text: `${unknown.length === 1 ? 'An item isn\'t' : `${unknown.length} items aren't`} on this quote — use get_quote for its item_ids.`, data: { unknown_item_ids: unknown }, isError: true }

    const done: string[] = []
    const problems: string[] = []
    try {
      for (const id of removes) {
        await removeScopeItem(ctx.supabase, ctx.tenantId, quoteId, id)
        done.push(`removed ${onQuote.get(id)?.item_description ?? 'a line'}`)
      }
      for (const u of updates) {
        const fields = itemFields(u)
        // Typing a new description makes it a custom line (the editor does the same)
        if ('item_description' in fields) Object.assign(fields, { scope_library_id: null, is_custom: true })
        if (!Object.keys(fields).length) continue
        const saved = await updateScopeItem(ctx.supabase, ctx.tenantId, quoteId, String(u.item_id), fields)
        done.push(`changed ${saved.item_description ?? 'a line'} (now ${amount(saved.line_total)})`)
      }
    } catch (err) {
      if (!(err instanceof QuoteEditError)) throw err
      problems.push(`Stopped: ${err.message}.`)
    }
    if (!problems.length) {
      const { added, error } = await addItems(quoteId, adds, ctx)
      done.push(...added.map(a => `added ${a.item_description} (${amount(a.line_total)})`))
      if (error) problems.push(error)
    }
    if (done.length) await repricePreliminaries(ctx.supabase, ctx.tenantId, quoteId)

    const after = await loadQuote(quoteId, ctx)
    const view = after ? quoteView(after) : null
    return {
      text: [
        `${loaded.quote.quote_ref ?? 'Quote'}: ${done.length ? done.join('; ') : 'nothing changed'}.`,
        ...(view ? [`Total now ${money(view.total_inc_gst)} inc GST (${view.item_count} items).`] : []),
        ...problems,
      ].join(' '),
      data: { quote: view, ...(problems.length ? { problems } : {}) },
      ...(problems.length && !done.length ? { isError: true } : {}),
    }
  },
}
