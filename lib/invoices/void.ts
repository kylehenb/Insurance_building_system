import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { getAccountingProvider } from '@/lib/accounting/client'
import { recalcInvoiceTotals, type Invoice } from '@/lib/invoices/edit'

// Voiding an invoice: it stays on the job (status 'voided') with who voided
// it, when and why, and stops counting — job totals, the balance and
// quoted-amounts invoices' deductions and the payment poll all leave voided
// invoices out. An invoice already in the accounting system is voided there
// too. Voiding an excess invoice takes it off the job's draft quoted-amounts
// invoices; sent ones are reported, as their copies can't change. Used by
// the invoice page's Void button (DELETE /api/invoices/[id]) and the voice
// connector. The caller checks invoices.manage.

type Client = SupabaseClient<Database>

export class InvoiceVoidError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'InvoiceVoidError'
  }
}

/** The excess deduction generateInvoice puts on a quoted-amounts invoice */
export const EXCESS_DEDUCTION = 'Policy Excess Payment Received'

const round2 = (n: number) => Math.round(n * 100) / 100
const aud = (n: number) => n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })

export interface VoidInvoiceResult {
  invoice: Invoice
  /**
   * not_synced: never reached the accounting system; voided: voided there too;
   * failed: couldn't void it there (void it by hand); manual: a trade's bill, removed by hand
   */
  accounting: 'not_synced' | 'voided' | 'failed' | 'manual'
  /** Draft quoted-amounts invoices whose excess deduction changed */
  adjusted: { invoice_ref: string | null; amount_inc_gst: number | null }[]
  /** Things the user needs to do or know */
  warnings: string[]
}

/** Why an invoice can't be voided, or null if it can. */
export function voidRefusal(invoice: Pick<Invoice, 'status' | 'invoice_ref' | 'paid_date'>): string | null {
  const ref = invoice.invoice_ref ?? 'This invoice'
  if (invoice.status === 'voided') return `${ref} is already voided.`
  if (invoice.status === 'paid' || invoice.paid_date) return `${ref} has been paid — refund or credit it in the accounting system instead of voiding it.`
  return null
}

export async function voidInvoice(
  supabase: Client,
  tenantId: string,
  invoiceId: string,
  { reason, userId }: { reason?: string | null; userId?: string | null } = {},
): Promise<VoidInvoiceResult> {
  const { data: invoice, error } = await supabase.from('invoices').select('*').eq('id', invoiceId).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw new InvoiceVoidError(error.message, 500)
  if (!invoice) throw new InvoiceVoidError('Invoice not found', 404)
  const refused = voidRefusal(invoice)
  if (refused) throw new InvoiceVoidError(refused, 409)

  const ref = invoice.invoice_ref ?? 'The invoice'
  const warnings: string[] = []
  let accounting: VoidInvoiceResult['accounting'] = 'not_synced'
  let syncError: string | null = null
  const inAccounting = invoice.accounting_sync_status === 'synced' || invoice.accounting_sync_status === 'pending'
  if (inAccounting && invoice.direction === 'outbound' && invoice.accounting_ref_id) {
    try {
      const provider = await getAccountingProvider(supabase as unknown as SupabaseClient, tenantId)
      await provider.voidInvoice(invoice.accounting_ref_id)
      accounting = 'voided'
    } catch (err) {
      accounting = 'failed'
      syncError = `Void in the accounting system failed: ${err instanceof Error ? err.message : String(err)}`
      console.error(`[invoice-void] ${invoiceId}:`, err)
      warnings.push(`${ref} couldn't be voided in the accounting system — void it there by hand.`)
    }
  } else if (inAccounting) {
    accounting = invoice.direction === 'outbound' ? 'failed' : 'manual'
    warnings.push(invoice.direction === 'outbound'
      ? `${ref} may already be in the accounting system — check and void it there by hand.`
      : `${ref} is a bill in the accounting system — delete or void it there by hand.`)
  }

  const { data: voided, error: updateError } = await supabase
    .from('invoices')
    .update({
      status: 'voided',
      voided_at: new Date().toISOString(),
      voided_by: userId || null,
      void_reason: reason?.trim() || null,
      ...(accounting === 'voided' ? { accounting_sync_status: 'voided', accounting_sync_error: null, accounting_last_synced_at: new Date().toISOString() } : {}),
      ...(syncError ? { accounting_sync_error: syncError } : {}),
    })
    .eq('id', invoiceId).eq('tenant_id', tenantId).neq('status', 'voided')
    .select('*').maybeSingle()
  if (updateError) throw new InvoiceVoidError(updateError.message, 500)
  if (!voided) throw new InvoiceVoidError(`${ref} is already voided.`, 409)

  const adjusted = invoice.invoice_type === 'excess' && invoice.direction === 'outbound'
    ? await afterExcessVoided(supabase, tenantId, invoice, warnings)
    : []

  return { invoice: voided, accounting, adjusted, warnings }
}

/**
 * The job's quoted-amounts invoices took the excess off. Drafts are
 * re-worked from the excess invoices still standing; sent ones can't change,
 * so they're reported.
 */
async function afterExcessVoided(supabase: Client, tenantId: string, voided: Invoice, warnings: string[]): Promise<VoidInvoiceResult['adjusted']> {
  const [{ data: others }, { data: excesses }, { data: job }] = await Promise.all([
    supabase.from('invoices').select('id, invoice_ref, invoice_type, status')
      .eq('tenant_id', tenantId).eq('job_id', voided.job_id).eq('direction', 'outbound').neq('status', 'voided'),
    supabase.from('invoices').select('amount_inc_gst')
      .eq('tenant_id', tenantId).eq('job_id', voided.job_id).eq('invoice_type', 'excess').neq('status', 'voided'),
    supabase.from('jobs').select('excess_decision').eq('tenant_id', tenantId).eq('id', voided.job_id).maybeSingle(),
  ])
  const stillDue = round2((excesses ?? []).reduce((s, i) => s + (i.amount_inc_gst ?? 0), 0))
  const quoted = (others ?? []).filter(i => i.invoice_type === 'quoted_amounts')
  const { data: deductions } = quoted.length
    ? await supabase.from('invoice_deductions').select('id, invoice_id, amount_inc_gst')
        .eq('tenant_id', tenantId).in('invoice_id', quoted.map(i => i.id)).eq('description', EXCESS_DEDUCTION)
    : { data: [] }

  const adjusted: VoidInvoiceResult['adjusted'] = []
  for (const inv of quoted) {
    const mine = (deductions ?? []).filter(d => d.invoice_id === inv.id)
    if (!mine.length) continue
    if (inv.status !== 'draft') {
      warnings.push(`${inv.invoice_ref ?? 'A quoted-amounts invoice'} was ${inv.status} with the excess taken off — it needs re-issuing.`)
      continue
    }
    const [keep, ...extra] = mine
    if (stillDue > 0) {
      await supabase.from('invoice_deductions').update({ amount_inc_gst: stillDue }).eq('id', keep.id).eq('tenant_id', tenantId)
    } else {
      await supabase.from('invoice_deductions').delete().eq('id', keep.id).eq('tenant_id', tenantId)
    }
    for (const d of extra) await supabase.from('invoice_deductions').delete().eq('id', d.id).eq('tenant_id', tenantId)
    await recalcInvoiceTotals(supabase, tenantId, inv.id)
    const { data: after } = await supabase.from('invoices').select('amount_inc_gst').eq('id', inv.id).eq('tenant_id', tenantId).maybeSingle()
    adjusted.push({ invoice_ref: inv.invoice_ref, amount_inc_gst: after?.amount_inc_gst ?? null })
  }
  for (const b of (others ?? []).filter(i => i.invoice_type === 'balance' && i.status === 'draft')) {
    warnings.push(`Draft balance invoice ${b.invoice_ref ?? ''} may have counted the ${aud(voided.amount_inc_gst ?? 0)} excess as already invoiced — check it.`.replace('  ', ' '))
  }
  if (job?.excess_decision === 'collect') {
    warnings.push('The job\'s excess decision still says collecting — record the new decision if the excess isn\'t being collected.')
  }
  return adjusted
}
