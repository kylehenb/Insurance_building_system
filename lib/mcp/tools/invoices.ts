import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { money, spokenDate } from '@/lib/mcp/tools/work-orders'
import { isToolResult, jobFromArgs } from '@/lib/mcp/tools/excess'
import { INVOICE_TYPES, InvoiceGenerateError, generateInvoice } from '@/lib/invoices/generate'
import {
  InvoiceEditError,
  addInvoiceLine,
  invoiceLinesLockedReason,
  removeInvoiceLine,
  updateInvoice,
  updateInvoiceLine,
  type Invoice,
  type InvoiceDeduction,
  type InvoiceLine,
  type InvoiceLineFields,
} from '@/lib/invoices/edit'

// Invoices by voice: reading one with its lines, raising one (the invoice
// buttons' generateInvoice), and changing its details and lines
// (lib/invoices/edit.ts, the same totals rule as the invoice editor).
// Sending — which marks it sent and pushes it to accounting — stays with
// send_documents.

const round2 = (n: number) => Math.round(n * 100) / 100
const amount = (n: number | null | undefined) => money(round2(n ?? 0))

const TYPE_LABELS: Record<string, string> = {
  assessment: 'assessment (BAR) report', make_safe: 'make safe', roof: 'roof report', leak_detection: 'leak detection',
  excess: 'excess', balance: 'balance', quoted_amounts: 'quoted amounts', variations: 'variations', custom: 'custom',
}
const REPORT_TYPES = ['assessment', 'make_safe', 'roof', 'leak_detection']

export interface InvoiceView {
  invoice_id: string
  invoice_ref: string | null
  job_number: string | null
  type: string
  status: string | null
  issued_date: string | null
  builders_margin_pct: number | null
  amount_ex_gst: number | null
  gst: number | null
  amount_inc_gst: number | null
  paid_date: string | null
  accounting_sync_status: string | null
  notes: string | null
  lines: { line_id: string; description: string; quantity: number; unit: string | null; unit_price: number; line_total: number; charged: boolean; quote_ref: string | null }[]
  deductions: { description: string | null; amount_inc_gst: number | null }[]
  warnings: string[]
}

async function loadInvoice(invoiceId: string, ctx: McpContext) {
  const { supabase, tenantId } = ctx
  const { data: invoice, error } = await supabase.from('invoices').select('*').eq('tenant_id', tenantId).eq('id', invoiceId).maybeSingle()
  if (error) throw error
  if (!invoice) return null
  const [lines, deductions, job] = await Promise.all([
    supabase.from('invoice_line_items').select('*').eq('tenant_id', tenantId).eq('invoice_id', invoiceId).order('sort_order', { ascending: true }),
    supabase.from('invoice_deductions').select('*').eq('tenant_id', tenantId).eq('invoice_id', invoiceId).order('sort_order', { ascending: true }),
    supabase.from('jobs').select('job_number').eq('tenant_id', tenantId).eq('id', invoice.job_id).maybeSingle(),
  ])
  for (const res of [lines, deductions, job]) if (res.error) throw res.error
  return { invoice, lines: lines.data ?? [], deductions: deductions.data ?? [], jobNumber: job.data?.job_number ?? null }
}

function invoiceWarnings(invoice: Invoice): string[] {
  const warnings: string[] = []
  const locked = invoiceLinesLockedReason(invoice)
  if (locked) warnings.push(locked)
  else if (invoice.status && invoice.status !== 'draft') {
    warnings.push(`Already ${invoice.status}${invoice.accounting_sync_status ? ` (accounting: ${invoice.accounting_sync_status})` : ''} — changes here don't update the copy the insurer or the accounting system already has.`)
  }
  if (invoice.paid_date) warnings.push(`Paid on ${spokenDate(invoice.paid_date)}.`)
  if (!invoice.amount_inc_gst) warnings.push('The total is $0.')
  return warnings
}

function invoiceView(invoice: Invoice, lines: InvoiceLine[], deductions: InvoiceDeduction[], jobNumber: string | null): InvoiceView {
  return {
    invoice_id: invoice.id,
    invoice_ref: invoice.invoice_ref,
    job_number: jobNumber,
    type: invoice.invoice_type,
    status: invoice.status,
    issued_date: invoice.issued_date,
    builders_margin_pct: invoice.markup_pct,
    amount_ex_gst: invoice.amount_ex_gst,
    gst: invoice.gst,
    amount_inc_gst: invoice.amount_inc_gst,
    paid_date: invoice.paid_date,
    accounting_sync_status: invoice.accounting_sync_status,
    notes: invoice.notes,
    lines: lines.map(l => ({
      line_id: l.id, description: l.description, quantity: l.quantity, unit: l.unit, unit_price: l.unit_price,
      line_total: l.line_total, charged: l.completed !== false, quote_ref: l.quote_ref,
    })),
    deductions: deductions.map(d => ({ description: d.description, amount_inc_gst: d.amount_inc_gst })),
    warnings: invoiceWarnings(invoice),
  }
}

const headline = (v: InvoiceView) =>
  `${v.invoice_ref ?? 'Invoice'} on ${v.job_number ?? 'unknown job'} (${TYPE_LABELS[v.type] ?? v.type}): ${v.status ?? 'no status'}` +
  `${v.issued_date ? `, dated ${spokenDate(v.issued_date)}` : ''}. ${amount(v.amount_ex_gst)} + GST ${amount(v.gst)} = ${amount(v.amount_inc_gst)}` +
  `${v.builders_margin_pct ? ` (includes ${round2(v.builders_margin_pct * 100)}% builder's margin)` : ''}.`

function describe(v: InvoiceView): string {
  return [
    headline(v),
    ...(v.lines.length
      ? v.lines.map(l => `- ${l.description || '(no description)'}: ${l.quantity}${l.unit ? ` ${l.unit}` : ''} × ${amount(l.unit_price)} = ${amount(l.line_total)}${l.charged ? '' : ' (not charged)'}`)
      : ['No lines.']),
    ...v.deductions.map(d => `- Less ${d.description ?? 'deduction'}: ${amount(d.amount_inc_gst)} inc GST`),
    ...(v.notes?.trim() ? [`Notes: ${v.notes.trim()}`] : []),
    ...(v.warnings.length ? [`Warnings: ${v.warnings.join(' ')}`] : []),
  ].join('\n')
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const notFound = (): McpToolResult => ({ text: 'No such invoice — use get_invoice with the job number to list them.', isError: true })

function errorResult(err: unknown): McpToolResult {
  if (err instanceof InvoiceEditError || err instanceof InvoiceGenerateError) return { text: err.message, data: { status: err.status }, isError: true }
  throw err
}

export const getInvoice: McpTool = {
  name: 'get_invoice',
  title: 'Get invoice',
  description: [
    'Reads an invoice: its type, status, date, lines (description, quantity, unit price, total, and whether each is charged), deductions, builder\'s margin, totals and accounting sync status, with warnings (voided, already sent, paid, $0).',
    'Give invoice_id (from list_job_documents), or just job_number to list the job\'s invoices to us (not trades\' invoices) and pick one.',
    'Each line has a line_id for edit_invoice_items.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      invoice_id: { type: 'string' },
      job_number: { type: 'string', description: 'Job number, e.g. IRC1001 — lists its invoices when no invoice_id is given.' },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const invoiceId = str(args.invoice_id)
    if (!invoiceId) {
      if (!str(args.job_number)) return { text: 'Which invoice, or which job?', isError: true }
      const job = await jobFromArgs(args, ctx)
      if (isToolResult(job)) return job
      const { data: invoices, error } = await ctx.supabase
        .from('invoices').select('*').eq('tenant_id', ctx.tenantId).eq('job_id', job.id).eq('direction', 'outbound').neq('status', 'voided')
        .order('created_at', { ascending: true })
      if (error) throw error
      if (!invoices?.length) return { text: `${job.job_number} has no invoices.`, data: { job_number: job.job_number, invoices: [] } }
      if (invoices.length === 1) return getInvoice.run({ invoice_id: invoices[0].id }, ctx)
      const views = invoices.map(i => invoiceView(i, [], [], job.job_number))
      return {
        text: [`${job.job_number} has ${views.length} invoices — which one?`, ...views.map(v => `- ${headline(v)}`)].join('\n'),
        data: { job_number: job.job_number, invoices: views.map(({ lines: _l, deductions: _d, ...v }) => v) },
      }
    }
    const loaded = await loadInvoice(invoiceId, ctx)
    if (!loaded) return notFound()
    const view = invoiceView(loaded.invoice, loaded.lines, loaded.deductions, loaded.jobNumber)
    return { text: describe(view), data: { invoice: view } }
  },
}

const LINE_FIELDS = {
  description: { type: 'string' },
  quantity: { type: 'number' },
  unit: { type: 'string', description: 'e.g. each, hr, m2.' },
  unit_price: { type: 'number', description: 'Price per unit, ex GST.' },
  charged: { type: 'boolean', description: 'false keeps the line on the invoice without charging it (the editor\'s tick box).' },
}
const NEW_LINES_SCHEMA = {
  type: 'array',
  maxItems: 40,
  items: { type: 'object', properties: LINE_FIELDS, required: ['description'], additionalProperties: false },
}

function lineFields(input: Record<string, unknown>): InvoiceLineFields {
  const out: InvoiceLineFields = {}
  if (typeof input.description === 'string') out.description = input.description.trim()
  if (num(input.quantity) !== undefined) out.quantity = num(input.quantity)
  if (num(input.unit_price) !== undefined) out.unit_price = round2(num(input.unit_price)!)
  if (typeof input.unit === 'string') out.unit = input.unit.trim() || null
  if (typeof input.charged === 'boolean') out.completed = input.charged
  return out
}

async function addLines(invoiceId: string, inputs: Record<string, unknown>[], ctx: McpContext): Promise<{ added: InvoiceLine[]; error?: string }> {
  const added: InvoiceLine[] = []
  for (const [idx, input] of inputs.entries()) {
    const fields = lineFields(input)
    if (!fields.description) return { added, error: `Line ${idx + 1} needs a description.` }
    try {
      added.push(await addInvoiceLine(ctx.supabase, ctx.tenantId, invoiceId, fields))
    } catch (err) {
      if (err instanceof InvoiceEditError) return { added, error: `Line ${idx + 1} (${fields.description}) wasn't added: ${err.message}.` }
      throw err
    }
  }
  return { added }
}

export const createInvoiceTool: McpTool = {
  name: 'create_invoice',
  title: 'Create invoice',
  description: [
    'Raises a draft invoice on a job exactly like the invoice buttons on the Invoices tab, which work out its lines and amounts:',
    'assessment, make_safe, roof and leak_detection bill a report at the insurer\'s price (give report_id, from list_job_documents);',
    'quoted_amounts bills the approved quotes (less the excess); variations bills work order variations; balance bills what\'s left;',
    'excess bills the homeowner the excess (excess_amount_inc_gst, else the job\'s excess); custom starts empty — give lines.',
    'Lines can also be added to any type straight away. Nothing is sent: use send_documents to send it.',
    'Check list_job_documents first so you don\'t raise a second invoice for the same thing; read back the type and amounts and get a clear yes first.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      job_number: { type: 'string', description: 'Job number, e.g. IRC1001.' },
      type: { type: 'string', enum: [...INVOICE_TYPES] },
      report_id: { type: 'string', description: 'For assessment, make_safe, roof and leak_detection: the report being billed.' },
      excess_amount_inc_gst: { type: 'number', description: 'excess only: the amount inc GST, if not the job\'s excess.' },
      lines: { ...NEW_LINES_SCHEMA, description: 'Lines to add after it\'s raised (custom invoices start empty).' },
    },
    required: ['job_number', 'type'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  permission: 'invoices.manage',

  async run(args, ctx): Promise<McpToolResult> {
    const type = typeof args.type === 'string' ? args.type : ''
    if (!(INVOICE_TYPES as readonly string[]).includes(type)) return { text: `Invoice type must be one of ${INVOICE_TYPES.join(', ')}.`, isError: true }
    if (REPORT_TYPES.includes(type) && !str(args.report_id)) return { text: 'Which report is this invoice for? Give its report_id from list_job_documents.', isError: true }
    const job = await jobFromArgs(args, ctx)
    if (isToolResult(job)) return job

    let invoiceId: string
    try {
      const generated = await generateInvoice(ctx.supabase, ctx.tenantId, {
        type, jobId: job.id, reportId: str(args.report_id), excessAmountIncGst: num(args.excess_amount_inc_gst),
      })
      invoiceId = generated.invoice.id
    } catch (err) {
      return errorResult(err)
    }
    const lines = Array.isArray(args.lines) ? args.lines as Record<string, unknown>[] : []
    const { error } = await addLines(invoiceId, lines, ctx)

    const loaded = await loadInvoice(invoiceId, ctx)
    const view = loaded ? invoiceView(loaded.invoice, loaded.lines, loaded.deductions, loaded.jobNumber) : null
    return {
      text: [`Created ${view?.invoice_ref ?? 'the invoice'} as a draft.`, ...(view ? [describe(view)] : []), ...(error ? [error] : [])].join('\n'),
      data: { invoice: view, ...(error ? { problems: [error] } : {}) },
    }
  },
}

export const updateInvoiceTool: McpTool = {
  name: 'update_invoice',
  title: 'Update invoice',
  description: [
    'Changes an invoice\'s date (only while it\'s a draft), notes or builder\'s margin (which re-totals it), as the invoice editor does.',
    'To send it (which marks it sent and pushes it to the accounting system) use send_documents.',
    'Read back the change and get a clear yes first.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      invoice_id: { type: 'string' },
      issued_date: { type: 'string', description: 'Invoice date, YYYY-MM-DD.' },
      notes: { type: 'string', description: 'Replaces the invoice notes.' },
      builders_margin_pct: { type: 'number', description: 'Builder\'s margin as a percentage, e.g. 19 for 19%; 0 for none.' },
    },
    required: ['invoice_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  permission: 'invoices.manage',

  async run(args, ctx): Promise<McpToolResult> {
    const loaded = await loadInvoice(str(args.invoice_id) ?? '', ctx)
    if (!loaded) return notFound()
    const locked = invoiceLinesLockedReason(loaded.invoice)
    if (locked) return { text: locked, isError: true }

    const updates: Parameters<typeof updateInvoice>[3] = {}
    if (typeof args.issued_date === 'string') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.issued_date) || Number.isNaN(Date.parse(args.issued_date))) return { text: 'The invoice date should be YYYY-MM-DD.', isError: true }
      updates.issued_date = args.issued_date
    }
    if (typeof args.notes === 'string') updates.notes = args.notes.trim() || null
    if (num(args.builders_margin_pct) !== undefined) {
      const margin = num(args.builders_margin_pct)!
      if (margin < 0 || margin > 100) return { text: 'The builder\'s margin should be a percentage between 0 and 100.', isError: true }
      updates.markup_pct = round2(margin) / 100
    }
    if (!Object.keys(updates).length) return { text: 'What should change on the invoice?', isError: true }

    try {
      await updateInvoice(ctx.supabase, ctx.tenantId, loaded.invoice.id, updates)
    } catch (err) {
      return errorResult(err)
    }
    const after = await loadInvoice(loaded.invoice.id, ctx)
    const view = after ? invoiceView(after.invoice, after.lines, after.deductions, after.jobNumber) : null
    return { text: `Updated. ${view ? headline(view) : ''}${view?.warnings.length ? ` ${view.warnings.join(' ')}` : ''}`.trim(), data: { invoice: view } }
  },
}

export const editInvoiceItems: McpTool = {
  name: 'edit_invoice_items',
  title: 'Edit invoice lines',
  description: [
    'Adds, changes and removes lines on one of our invoices, like the invoice editor: line total = quantity × unit price, and the invoice is re-totalled (margin, GST, deductions).',
    'Get line_ids from get_invoice. "charged: false" keeps a line without charging it. Excess invoices keep their amount.',
    'If the invoice was already sent, say so — the insurer\'s and the accounting system\'s copies don\'t change.',
    'Read back the changes and get a clear yes first; removing a line can\'t be undone.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      invoice_id: { type: 'string' },
      add: NEW_LINES_SCHEMA,
      update: {
        type: 'array',
        maxItems: 40,
        description: 'Changes to existing lines; only the fields given change.',
        items: { type: 'object', properties: { line_id: { type: 'string' }, ...LINE_FIELDS }, required: ['line_id'], additionalProperties: false },
      },
      remove: { type: 'array', maxItems: 40, items: { type: 'string' }, description: 'line_ids to remove.' },
    },
    required: ['invoice_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  permission: 'invoices.manage',

  async run(args, ctx): Promise<McpToolResult> {
    const loaded = await loadInvoice(str(args.invoice_id) ?? '', ctx)
    if (!loaded) return notFound()
    const locked = invoiceLinesLockedReason(loaded.invoice)
    if (locked) return { text: locked, isError: true }
    const invoiceId = loaded.invoice.id

    const adds = Array.isArray(args.add) ? args.add as Record<string, unknown>[] : []
    const updates = Array.isArray(args.update) ? args.update as Record<string, unknown>[] : []
    const removes = Array.isArray(args.remove) ? args.remove.filter((x): x is string => typeof x === 'string') : []
    if (!adds.length && !updates.length && !removes.length) return { text: 'What should change? Give lines to add, update or remove.', isError: true }

    const onInvoice = new Map(loaded.lines.map(l => [l.id, l]))
    const unknown = [...updates.map(u => String(u.line_id)), ...removes].filter(id => !onInvoice.has(id))
    if (unknown.length) return { text: `${unknown.length === 1 ? 'A line isn\'t' : `${unknown.length} lines aren't`} on this invoice — use get_invoice for its line_ids.`, data: { unknown_line_ids: unknown }, isError: true }

    const done: string[] = []
    const problems: string[] = []
    try {
      for (const id of removes) {
        await removeInvoiceLine(ctx.supabase, ctx.tenantId, invoiceId, id)
        done.push(`removed ${onInvoice.get(id)?.description || 'a line'}`)
      }
      for (const u of updates) {
        const fields = lineFields(u)
        if (!Object.keys(fields).length) continue
        const saved = await updateInvoiceLine(ctx.supabase, ctx.tenantId, invoiceId, String(u.line_id), fields)
        done.push(`changed ${saved.description || 'a line'} (now ${amount(saved.line_total)}${saved.completed === false ? ', not charged' : ''})`)
      }
    } catch (err) {
      if (!(err instanceof InvoiceEditError)) throw err
      problems.push(`Stopped: ${err.message}.`)
    }
    if (!problems.length) {
      const { added, error } = await addLines(invoiceId, adds, ctx)
      done.push(...added.map(a => `added ${a.description} (${amount(a.line_total)})`))
      if (error) problems.push(error)
    }

    const after = await loadInvoice(invoiceId, ctx)
    const view = after ? invoiceView(after.invoice, after.lines, after.deductions, after.jobNumber) : null
    return {
      text: [
        `${loaded.invoice.invoice_ref ?? 'Invoice'}: ${done.length ? done.join('; ') : 'nothing changed'}.`,
        ...(view ? [`Total now ${amount(view.amount_inc_gst)} inc GST.`] : []),
        ...problems,
        ...(view?.warnings.length ? view.warnings : []),
      ].join(' '),
      data: { invoice: view, ...(problems.length ? { problems } : {}) },
      ...(problems.length && !done.length ? { isError: true } : {}),
    }
  },
}
