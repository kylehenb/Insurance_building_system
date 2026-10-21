import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { syncInvoiceToAccounting } from '@/lib/accounting/sync'
import { generateExcessInvoice } from '@/lib/invoices/generators'
import { generateInvoiceRef } from '@/lib/invoices/ref'

// Excess invoices created as part of a send (e.g. with a signing request).
// Same generator, numbering and accounting sync as the Invoices tab "Excess"
// button (app/api/invoices/generate), split into steps so the caller can
// create the draft, email it, and only then mark it sent:
//
//   createExcessInvoiceDraft → (attach the PDF and send the email) →
//     markInvoiceSent        on success (pushes it to the accounting system)
//     deleteDraftInvoice     on failure (nothing half-done)

type Service = SupabaseClient<Database>
type Invoice = Database['public']['Tables']['invoices']['Row']

const DEFAULT_GST_PCT = 0.1

/** Today's date in Perth, YYYY-MM-DD (the database default is UTC). */
export function perthToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export async function createExcessInvoiceDraft(service: Service, params: {
  tenantId: string
  jobId: string
  amountIncGst: number
}): Promise<Invoice> {
  const { tenantId, jobId } = params
  if (!(params.amountIncGst > 0)) throw new Error('Excess amount must be more than $0')

  const { data: job } = await service
    .from('jobs')
    .select('job_number, claim_number, insured_name')
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!job) throw new Error('Job not found')

  const generated = generateExcessInvoice({
    tenantId,
    jobId,
    claimNumber: job.claim_number,
    insuredName: job.insured_name,
    excessAmountIncGst: params.amountIncGst,
    gstPct: DEFAULT_GST_PCT,
  })
  const invoiceRef = await generateInvoiceRef(service, tenantId, jobId, job.job_number ?? jobId)

  const { data: invoice, error } = await service
    .from('invoices')
    .insert({ ...generated.invoiceData, invoice_ref: invoiceRef, issued_date: perthToday() })
    .select('*')
    .single()
  if (error || !invoice) throw new Error(`Could not create the excess invoice: ${error?.message ?? 'unknown error'}`)

  const { error: itemsError } = await service
    .from('invoice_line_items')
    .insert(generated.lineItems.map(li => ({ ...li, invoice_id: invoice.id })))
  if (itemsError) {
    await deleteDraftInvoice(service, tenantId, invoice.id)
    throw new Error(`Could not create the excess invoice lines: ${itemsError.message}`)
  }
  return invoice
}

/**
 * Marks the invoice sent (as the Invoices tab does when you mark it sent) and
 * pushes it to the accounting system. A sync failure is recorded on the
 * invoice by syncInvoiceToAccounting and never thrown.
 */
export async function markInvoiceSent(service: Service, tenantId: string, invoiceId: string): Promise<void> {
  const { data: current } = await service
    .from('invoices').select('status').eq('id', invoiceId).eq('tenant_id', tenantId).maybeSingle()
  if (!current || current.status === 'sent') return

  const { error } = await service
    .from('invoices')
    .update({ status: 'sent' })
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
  if (error) {
    console.error(`[excess-invoice] could not mark ${invoiceId} sent:`, error)
    return
  }
  try {
    await syncInvoiceToAccounting(service, tenantId, invoiceId)
  } catch (err) {
    console.error(`[excess-invoice] accounting sync error for ${invoiceId}:`, err)
  }
}

/** Removes a draft invoice created for a send that failed. Never touches a sent invoice. */
export async function deleteDraftInvoice(service: Service, tenantId: string, invoiceId: string): Promise<void> {
  const { error } = await service
    .from('invoices')
    .delete()
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .eq('status', 'draft')
  if (error) console.error(`[excess-invoice] could not remove draft ${invoiceId}:`, error)
}
