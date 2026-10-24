import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { money, summariseWorkOrder } from '@/lib/mcp/tools/work-orders'
import { isToolResult, jobFromArgs } from '@/lib/mcp/tools/excess'
import {
  WorkOrderEditError,
  addWorkOrderItem,
  createWorkOrder,
  loadWorkOrderItems,
  removeWorkOrderItem,
  restoreWorkOrderItem,
  syncWorkOrdersFromQuote,
  updateWorkOrder,
  updateWorkOrderItem,
  type WorkOrderDetailsUpdate,
  type WorkOrderItemFields,
} from '@/lib/work-orders/edit'

// Making and changing work orders by voice: Sync from quote, adding one for
// a trade, assigning the contractor and amount, and the work order's own
// items — all through lib/work-orders/edit.ts, the same rules as the Work
// Orders tab. Reading which ones exist and sending them stay with
// find_work_orders and send_work_order.

const round2 = (n: number) => Math.round(n * 100) / 100
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function errorResult(err: unknown): McpToolResult {
  if (err instanceof WorkOrderEditError) return { text: err.message, data: { status: err.status }, isError: true }
  throw err
}

/** Contractors whose business name, contact or trade matches what the user said */
async function findContractors(name: string, ctx: McpContext) {
  const { data, error } = await ctx.supabase
    .from('trades').select('id, business_name, primary_trade, primary_contact, contact_email, status').eq('tenant_id', ctx.tenantId)
  if (error) throw error
  const needle = name.toLowerCase()
  const all = data ?? []
  const exact = all.filter(t => [t.business_name, t.primary_contact].some(v => v?.toLowerCase() === needle))
  if (exact.length) return exact
  return all.filter(t => [t.business_name, t.primary_contact, t.primary_trade].some(v => v?.toLowerCase().includes(needle)))
}

type ContractorPick = { id: string; business_name: string | null } | McpToolResult
async function pickContractor(name: string, ctx: McpContext): Promise<ContractorPick> {
  const matches = await findContractors(name, ctx)
  if (matches.length === 1) return matches[0]
  if (!matches.length) return { text: `No contractor matching "${name}".`, isError: true }
  return {
    text: `Several contractors match "${name}": ${matches.slice(0, 8).map(t => `${t.business_name ?? 'unnamed'}${t.primary_trade ? ` (${t.primary_trade})` : ''}`).join(', ')}. Which one?`,
    data: { contractors: matches.slice(0, 8).map(t => ({ trade_id: t.id, business_name: t.business_name, primary_trade: t.primary_trade })) },
    isError: true,
  }
}

async function describeWorkOrder(workOrderId: string, ctx: McpContext) {
  const [summary, loaded] = await Promise.all([
    summariseWorkOrder(workOrderId, ctx),
    loadWorkOrderItems(ctx.supabase, ctx.tenantId, workOrderId),
  ])
  if (!summary) throw new WorkOrderEditError('Work order not found', 404)
  const items = loaded.items.map(i => ({
    item_id: i.id, description: i.item_description, room: i.room, qty: i.qty, rate_labour: i.rate_labour, rate_materials: i.rate_materials,
    line_total: round2(i.line_total ?? 0), added_on_work_order: i.isAddedInWO, removed: i.isDeleted,
  }))
  const who = summary.business_name && summary.business_name !== summary.trade ? `${summary.trade} (${summary.business_name})` : summary.trade
  const amountNote = loaded.workOrder.agreed_amount != null
    ? `agreed amount ${money(loaded.workOrder.agreed_amount)} (items add up to ${money(loaded.itemsTotal)})`
    : `${money(loaded.itemsTotal)} from its items`
  const text = [
    `${who} work order on ${summary.job_number}: ${amountNote}, ${summary.sent ? 'sent' : 'not sent'}.${summary.warnings.length ? ' ' + summary.warnings.join(' ') : ''}`,
    ...(items.length
      ? items.map(i => `- ${i.description?.trim() || '(no description)'}${i.room ? ` [${i.room}]` : ''}: ${i.qty} × ${money(round2(i.rate_labour + i.rate_materials))} = ${money(i.line_total)}${i.removed ? ' (removed from this work order)' : ''}${i.added_on_work_order ? ' (added on the work order)' : ''}`)
      : ['No items.']),
  ].join('\n')
  return { text, data: { work_order: { ...summary, agreed_amount: loaded.workOrder.agreed_amount, items_total: loaded.itemsTotal, estimated_hours: loaded.workOrder.estimated_hours, items } } }
}

export const getWorkOrder: McpTool = {
  name: 'get_work_order',
  title: 'Get work order',
  description: [
    'Reads one work order\'s line items as the trade will see them (the quote\'s items for that trade with the work order\'s own changes, plus items added on the work order; removed ones are flagged),',
    'the agreed amount, what the items add up to, the contractor and whether it has been sent. Get work_order_id from find_work_orders.',
    'Each item has an item_id for edit_work_order_items.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { work_order_id: { type: 'string' } },
    required: ['work_order_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    try {
      return await describeWorkOrder(str(args.work_order_id) ?? '', ctx)
    } catch (err) {
      return errorResult(err)
    }
  },
}

export const createWorkOrdersFromQuote: McpTool = {
  name: 'create_work_orders_from_quote',
  title: 'Create work orders from quote',
  description: [
    'Sync from quote: creates a work order for each trade in the job\'s approved quote that doesn\'t have one yet (with their visits, matched to a contractor where one is on file), as the Work Orders tab\'s Sync button does.',
    'Approving a quote already does this, so it\'s for trades added since. Nothing is sent. Read back the job and get a yes first.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { job_number: { type: 'string', description: 'Job number, e.g. IRC1001.' } },
    required: ['job_number'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  permission: 'jobs.edit',

  async run(args, ctx): Promise<McpToolResult> {
    const job = await jobFromArgs(args, ctx)
    if (isToolResult(job)) return job
    try {
      const result = await syncWorkOrdersFromQuote(ctx.supabase, ctx.tenantId, job.id)
      const made = result.workOrdersCreated.map(w => w.trade_name ?? 'unnamed trade')
      return {
        text: made.length
          ? `${job.job_number}: created ${made.length} work order${made.length === 1 ? '' : 's'} — ${made.join(', ')}. Use find_work_orders to check contractors and amounts before sending.`
          : `${job.job_number}: ${result.message}.`,
        data: { job_number: job.job_number, created: result.workOrdersCreated.map(w => ({ work_order_id: w.id, trade: w.trade_name })), trades_in_quote: result.tradesInQuote },
      }
    } catch (err) {
      return errorResult(err)
    }
  },
}

export const createWorkOrderTool: McpTool = {
  name: 'create_work_order',
  title: 'Create work order',
  description: [
    'Adds a work order for one trade to a job, like adding a trade on the Work Orders tab. It picks up that trade\'s items from the job\'s approved quote (items whose trade matches trade_name), if there is one.',
    'Optionally assign the contractor (by business or contact name) and an agreed amount, and add items of its own with edit_work_order_items.',
    'Check find_work_orders first — the job may already have one for that trade. Read back what will be created and get a clear yes first. Nothing is sent.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      job_number: { type: 'string', description: 'Job number, e.g. IRC1001.' },
      trade_name: { type: 'string', description: 'Trade type, e.g. Plasterer, Electrician — as used on the quote\'s items.' },
      contractor: { type: 'string', description: 'The contractor\'s business or contact name.' },
      agreed_amount: { type: 'number', description: 'What the trade is paid, ex GST, if not the items total.' },
    },
    required: ['job_number', 'trade_name'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  permission: 'jobs.edit',

  async run(args, ctx): Promise<McpToolResult> {
    const tradeName = str(args.trade_name)
    if (!tradeName) return { text: 'Which trade is the work order for?', isError: true }
    const job = await jobFromArgs(args, ctx)
    if (isToolResult(job)) return job

    let tradeId: string | null = null
    if (str(args.contractor)) {
      const pick = await pickContractor(str(args.contractor)!, ctx)
      if (isToolResult(pick)) return pick
      tradeId = pick.id
    }
    const { data: quote, error } = await ctx.supabase
      .from('quotes').select('id').eq('tenant_id', ctx.tenantId).eq('job_id', job.id).eq('is_active_version', true)
      .in('status', ['approved', 'partially_approved']).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (error) throw error

    try {
      const wo = await createWorkOrder(ctx.supabase, ctx.tenantId, { jobId: job.id, tradeName, tradeId, quoteId: quote?.id ?? null })
      if (num(args.agreed_amount) !== undefined) await updateWorkOrder(ctx.supabase, ctx.tenantId, wo.id, { agreed_amount: round2(num(args.agreed_amount)!) })
      const described = await describeWorkOrder(wo.id, ctx)
      return { text: `Created. ${described.text}`, data: described.data }
    } catch (err) {
      return errorResult(err)
    }
  },
}

export const updateWorkOrderTool: McpTool = {
  name: 'update_work_order',
  title: 'Update work order',
  description: [
    'Changes a work order as its panel on the Work Orders tab does: the contractor (by business or contact name), the trade type, the agreed amount (what the trade is paid — clear_agreed_amount goes back to the items total), the trade\'s cost and the estimated hours.',
    'If it was already sent, say so: the trade isn\'t told about the change. Read back the change and get a clear yes first.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      work_order_id: { type: 'string' },
      contractor: { type: 'string', description: 'The contractor\'s business or contact name.' },
      trade_name: { type: 'string', description: 'Trade type, e.g. Plasterer — this decides which quote items it has.' },
      agreed_amount: { type: 'number', description: 'Ex GST.' },
      clear_agreed_amount: { type: 'boolean', description: 'Go back to the items total.' },
      trade_cost: { type: 'number' },
      estimated_hours: { type: 'number' },
    },
    required: ['work_order_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  permission: 'jobs.edit',

  async run(args, ctx): Promise<McpToolResult> {
    const workOrderId = str(args.work_order_id) ?? ''
    const updates: WorkOrderDetailsUpdate = {}
    const said: string[] = []
    if (str(args.contractor)) {
      const pick = await pickContractor(str(args.contractor)!, ctx)
      if (isToolResult(pick)) return pick
      updates.trade_id = pick.id
      said.push(`contractor ${pick.business_name ?? 'set'}`)
    }
    if (str(args.trade_name)) { updates.trade_name = str(args.trade_name); said.push(`trade ${updates.trade_name}`) }
    if (args.clear_agreed_amount === true) { updates.agreed_amount = null; said.push('agreed amount cleared') }
    else if (num(args.agreed_amount) !== undefined) { updates.agreed_amount = round2(num(args.agreed_amount)!); said.push(`agreed amount ${money(updates.agreed_amount)}`) }
    if (num(args.trade_cost) !== undefined) { updates.trade_cost = round2(num(args.trade_cost)!); said.push(`trade cost ${money(updates.trade_cost)}`) }
    if (num(args.estimated_hours) !== undefined) { updates.estimated_hours = num(args.estimated_hours)!; said.push(`${updates.estimated_hours} hours`) }
    if (!said.length) return { text: 'What should change on the work order?', isError: true }

    try {
      await updateWorkOrder(ctx.supabase, ctx.tenantId, workOrderId, updates)
      const described = await describeWorkOrder(workOrderId, ctx)
      return { text: `Updated: ${said.join(', ')}.\n${described.text}`, data: described.data }
    } catch (err) {
      return errorResult(err)
    }
  },
}

const ITEM_FIELDS = {
  description: { type: 'string' },
  room: { type: 'string' },
  qty: { type: 'number' },
  rate_labour: { type: 'number', description: 'Per unit, ex GST.' },
  rate_materials: { type: 'number', description: 'Per unit, ex GST.' },
}

function itemFields(input: Record<string, unknown>): WorkOrderItemFields {
  const out: WorkOrderItemFields = {}
  if (typeof input.description === 'string') out.item_description = input.description.trim()
  if (typeof input.room === 'string') out.room = input.room.trim() || null
  for (const k of ['qty', 'rate_labour', 'rate_materials'] as const) if (num(input[k]) !== undefined) out[k] = num(input[k])
  return out
}

export const editWorkOrderItems: McpTool = {
  name: 'edit_work_order_items',
  title: 'Edit work order items',
  description: [
    'Adds, changes, removes and restores items on one work order, like its panel on the Work Orders tab. Changes apply to this work order only — the quote stays as it was.',
    'Removing a quote item hides it from this work order (restore brings it back); removing an item added on the work order deletes it.',
    'Get item_ids from get_work_order. If an agreed amount is set the trade is paid that, not the items total — mention it.',
    'Read back the changes and get a clear yes first.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      work_order_id: { type: 'string' },
      add: { type: 'array', maxItems: 40, items: { type: 'object', properties: ITEM_FIELDS, required: ['description'], additionalProperties: false } },
      update: {
        type: 'array',
        maxItems: 40,
        items: { type: 'object', properties: { item_id: { type: 'string' }, ...ITEM_FIELDS }, required: ['item_id'], additionalProperties: false },
      },
      remove: { type: 'array', maxItems: 40, items: { type: 'string' }, description: 'item_ids to take off.' },
      restore: { type: 'array', maxItems: 40, items: { type: 'string' }, description: 'item_ids of removed quote items to put back.' },
    },
    required: ['work_order_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  permission: 'jobs.edit',

  async run(args, ctx): Promise<McpToolResult> {
    const workOrderId = str(args.work_order_id) ?? ''
    const list = (k: string) => (Array.isArray(args[k]) ? args[k] as unknown[] : [])
    const adds = list('add') as Record<string, unknown>[]
    const updates = list('update') as Record<string, unknown>[]
    const removes = list('remove').filter((x): x is string => typeof x === 'string')
    const restores = list('restore').filter((x): x is string => typeof x === 'string')
    if (!adds.length && !updates.length && !removes.length && !restores.length) return { text: 'What should change on the work order?', isError: true }

    let before
    try {
      before = await loadWorkOrderItems(ctx.supabase, ctx.tenantId, workOrderId)
    } catch (err) {
      return errorResult(err)
    }
    const known = new Set(before.items.map(i => i.id))
    const unknown = [...updates.map(u => String(u.item_id)), ...removes, ...restores].filter(id => !known.has(id))
    if (unknown.length) return { text: `${unknown.length === 1 ? 'An item isn\'t' : `${unknown.length} items aren't`} on this work order — use get_work_order for its item_ids.`, data: { unknown_item_ids: unknown }, isError: true }
    const name = (id: string) => before.items.find(i => i.id === id)?.item_description || 'an item'

    const done: string[] = []
    let problem: string | null = null
    try {
      for (const id of removes) { await removeWorkOrderItem(ctx.supabase, ctx.tenantId, workOrderId, id); done.push(`removed ${name(id)}`) }
      for (const id of restores) { await restoreWorkOrderItem(ctx.supabase, ctx.tenantId, workOrderId, id); done.push(`restored ${name(id)}`) }
      for (const u of updates) {
        const fields = itemFields(u)
        if (!Object.keys(fields).length) continue
        await updateWorkOrderItem(ctx.supabase, ctx.tenantId, workOrderId, String(u.item_id), fields)
        done.push(`changed ${fields.item_description ?? name(String(u.item_id))}`)
      }
      for (const a of adds) {
        const fields = itemFields(a)
        await addWorkOrderItem(ctx.supabase, ctx.tenantId, workOrderId, fields)
        done.push(`added ${fields.item_description}`)
      }
    } catch (err) {
      if (!(err instanceof WorkOrderEditError)) throw err
      problem = `Stopped: ${err.message}.`
    }

    const described = await describeWorkOrder(workOrderId, ctx)
    return {
      text: [`${done.length ? done.join('; ') : 'Nothing changed'}.`, ...(problem ? [problem] : []), described.text].join('\n'),
      data: { ...described.data, ...(problem ? { problems: [problem] } : {}) },
      ...(problem && !done.length ? { isError: true } : {}),
    }
  },
}
