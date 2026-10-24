import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { syncInvoiceToAccounting } from '@/lib/accounting/sync'
import { invoiceTotals } from '@/lib/invoices/totals'

// Changing an invoice after it's been raised: its details (date, notes,
// builder's margin, status — first marking it sent pushes it to accounting)
// and its lines, keeping the totals right. The totals rule is shared with the
// invoice editor (lib/invoices/totals.ts). Used by the invoice routes
// and the voice connector. New invoices come from lib/invoices/generate.ts.
// The caller checks invoices.manage.

type Client = SupabaseClient<Database>
export type Invoice = Database['public']['Tables']['invoices']['Row']
export type InvoiceLine = Database['public']['Tables']['invoice_line_items']['Row']
export type InvoiceDeduction = Database['public']['Tables']['invoice_deductions']['Row']
type InvoiceUpdate = Database['public']['Tables']['invoices']['Update']

export class InvoiceEditError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'InvoiceEditError'
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Saves the invoice's totals from its current lines and deductions. */
export async function recalcInvoiceTotals(supabase: Client, tenantId: string, invoiceId: string): Promise<void> {
  const [{ data: invoice }, { data: lines }, { data: deductions }] = await Promise.all([
    supabase.from('invoices').select('invoice_type, markup_pct, gst_treatment').eq('id', invoiceId).eq('tenant_id', tenantId).single(),
    supabase.from('invoice_line_items').select('line_total, completed').eq('invoice_id', invoiceId).eq('tenant_id', tenantId),
    supabase.from('invoice_deductions').select('amount_inc_gst').eq('invoice_id', invoiceId).eq('tenant_id', tenantId),
  ])
  if (!invoice) return
  const totals = invoiceTotals(invoice, lines ?? [], deductions ?? [])
  if (!totals) return
  const { error } = await supabase.from('invoices').update(totals).eq('id', invoiceId).eq('tenant_id', tenantId)
  if (error) throw new InvoiceEditError(error.message, 500)
}

async function loadInvoice(supabase: Client, tenantId: string, invoiceId: string): Promise<Invoice> {
  const { data, error } = await supabase.from('invoices').select('*').eq('id', invoiceId).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw new InvoiceEditError(error.message, 500)
  if (!data) throw new InvoiceEditError('Invoice not found', 404)
  return data
}

/** Why an invoice's lines can't be changed, or null if they can. */
export function invoiceLinesLockedReason(invoice: Pick<Invoice, 'status' | 'invoice_ref' | 'direction'>): string | null {
  if (invoice.status === 'voided') return `${invoice.invoice_ref ?? 'This invoice'} has been voided.`
  if (invoice.direction !== 'outbound') return `${invoice.invoice_ref ?? 'This invoice'} is a trade's invoice to us — it's changed on the Work Orders tab, not here.`
  return null
}

export interface InvoiceDetailsUpdate {
  status?: string
  /** YYYY-MM-DD; only while the invoice is a draft */
  issued_date?: string
  notes?: string | null
  /** Builder's margin as a fraction (0.19) */
  markup_pct?: number
}

/**
 * Changes an invoice's details. The date is locked once it's been sent;
 * first marking it sent pushes it to the accounting system; a new margin
 * re-totals it.
 */
export async function updateInvoice(
  supabase: Client,
  tenantId: string,
  invoiceId: string,
  updates: InvoiceDetailsUpdate,
): Promise<Invoice> {
  const current = await loadInvoice(supabase, tenantId, invoiceId)
  const previousStatus = current.status

  const allowedFields: InvoiceUpdate = {}
  if ('status' in updates) allowedFields.status = updates.status
  if ('issued_date' in updates) {
    if (previousStatus && previousStatus !== 'draft') {
      throw new InvoiceEditError('Invoice date is locked once the invoice has been sent', 400)
    }
    allowedFields.issued_date = updates.issued_date
  }
  if ('notes' in updates) allowedFields.notes = updates.notes
  if ('markup_pct' in updates) allowedFields.markup_pct = updates.markup_pct

  const { data: invoice, error } = await supabase
    .from('invoices').update(allowedFields).eq('id', invoiceId).eq('tenant_id', tenantId).select('*').single()
  if (error || !invoice) throw new InvoiceEditError(error?.message ?? 'Update failed', 500)

  if ('markup_pct' in updates) await recalcInvoiceTotals(supabase, tenantId, invoiceId)

  // Auto-trigger accounting sync when an invoice is first marked sent.
  // Must be awaited — Vercel terminates the execution context when the response is sent,
  // so a fire-and-forget void call is killed before it can write 'failed' to the DB.
  if (updates.status === 'sent' && previousStatus !== 'sent') {
    console.log(`[invoice-sync] Auto-triggering sync for invoice ${invoiceId} on status change to 'sent'`)
    try {
      await syncInvoiceToAccounting(supabase, tenantId, invoiceId)
    } catch (err: unknown) {
      // syncInvoiceToAccounting catches its own errors and writes 'failed' to the DB.
      // This outer catch is a last-resort guard and should never be reached.
      console.error(`[invoice-sync] Unexpected sync error for invoice ${invoiceId}:`, err)
    }
  }
  return 'markup_pct' in updates ? loadInvoice(supabase, tenantId, invoiceId) : invoice
}

export interface InvoiceLineFields {
  description?: string
  quantity?: number
  unit_price?: number
  unit?: string | null
  /** Unticked lines stay on the invoice but aren't charged */
  completed?: boolean
  library_item_id?: string | null
}

/** Adds a line to the end of an invoice and re-totals it. */
export async function addInvoiceLine(supabase: Client, tenantId: string, invoiceId: string, fields: InvoiceLineFields): Promise<InvoiceLine> {
  if (!fields.description) throw new InvoiceEditError('Missing required fields', 400)
  await loadInvoice(supabase, tenantId, invoiceId)

  const { data: last } = await supabase
    .from('invoice_line_items').select('sort_order').eq('invoice_id', invoiceId).eq('tenant_id', tenantId)
    .order('sort_order', { ascending: false }).limit(1).maybeSingle()
  const quantity = fields.quantity ?? 1
  const unitPrice = fields.unit_price ?? 0

  const { data: line, error } = await supabase
    .from('invoice_line_items')
    .insert({
      tenant_id: tenantId, invoice_id: invoiceId, description: fields.description, quantity, unit_price: unitPrice,
      line_total: round2(quantity * unitPrice), unit: fields.unit ?? null, library_item_id: fields.library_item_id ?? null,
      sort_order: (last?.sort_order ?? -1) + 1, ...(fields.completed === false ? { completed: false } : {}),
    })
    .select('*').single()
  if (error || !line) throw new InvoiceEditError(error?.message ?? 'Insert failed', 500)
  await recalcInvoiceTotals(supabase, tenantId, invoiceId)
  return line
}

/** Changes a line (a new quantity or price recalculates it) and re-totals the invoice. */
export async function updateInvoiceLine(
  supabase: Client,
  tenantId: string,
  invoiceId: string,
  lineId: string,
  fields: InvoiceLineFields,
): Promise<InvoiceLine> {
  const { data: current, error: currentErr } = await supabase
    .from('invoice_line_items').select('*').eq('id', lineId).eq('invoice_id', invoiceId).eq('tenant_id', tenantId).maybeSingle()
  if (currentErr) throw new InvoiceEditError(currentErr.message, 500)
  if (!current) throw new InvoiceEditError('Line not found on this invoice', 404)

  const patch: Database['public']['Tables']['invoice_line_items']['Update'] = {}
  for (const k of ['description', 'quantity', 'unit_price', 'unit', 'completed', 'library_item_id'] as const) {
    if (k in fields) (patch as Record<string, unknown>)[k] = fields[k]
  }
  if ('quantity' in fields || 'unit_price' in fields) {
    patch.line_total = round2((patch.quantity ?? current.quantity) * (patch.unit_price ?? current.unit_price))
  }

  const { data: line, error } = await supabase
    .from('invoice_line_items').update(patch).eq('id', lineId).eq('tenant_id', tenantId).select('*').single()
  if (error || !line) throw new InvoiceEditError(error?.message ?? 'Update failed', 500)
  await recalcInvoiceTotals(supabase, tenantId, invoiceId)
  return line
}

export async function removeInvoiceLine(supabase: Client, tenantId: string, invoiceId: string, lineId: string): Promise<void> {
  const { error } = await supabase
    .from('invoice_line_items').delete().eq('id', lineId).eq('invoice_id', invoiceId).eq('tenant_id', tenantId)
  if (error) throw new InvoiceEditError(error.message, 500)
  await recalcInvoiceTotals(supabase, tenantId, invoiceId)
}
