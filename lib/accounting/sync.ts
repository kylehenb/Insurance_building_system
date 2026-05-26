import type { SupabaseClient } from '@supabase/supabase-js'
import { getAccountingProvider } from './client'
import { mapIrcInvoiceToAccounting } from './mappers/ar-invoice'
import { mapIrcBillToAccounting } from './mappers/ap-bill'

interface InvoiceWithAccounting {
  id: string
  direction: string
  invoice_type: string
  accounting_sync_status: string | null
  accounting_ref_id: string | null
  accounting_bill_id: string | null
  job_id: string
  trade_id: string | null
}

async function markSyncFailed(
  supabase: SupabaseClient,
  tenantId: string,
  invoiceId: string,
  errorMessage: string
): Promise<void> {
  await supabase
    .from('invoices')
    .update({
      accounting_sync_status: 'failed',
      accounting_sync_error: errorMessage,
      accounting_last_synced_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
}

export async function syncInvoiceToAccounting(
  supabase: SupabaseClient,
  tenantId: string,
  invoiceId: string
): Promise<{ success: boolean; accountingRefId?: string; error?: string }> {
  // 1. Fetch invoice to check direction and current sync status
  const { data: rawInvoice, error: invoiceError } = await supabase
    .from('invoices')
    .select(
      'id, direction, invoice_type, accounting_sync_status, accounting_ref_id, accounting_bill_id, job_id, trade_id'
    )
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .single()

  if (invoiceError || !rawInvoice) {
    return {
      success: false,
      error: `Invoice not found: ${invoiceError?.message}`,
    }
  }

  const invoice = rawInvoice as InvoiceWithAccounting

  // Skip if already synced
  if (invoice.accounting_sync_status === 'synced') {
    return {
      success: true,
      accountingRefId:
        invoice.accounting_ref_id ?? invoice.accounting_bill_id ?? undefined,
    }
  }

  // 2. Mark as pending
  await supabase
    .from('invoices')
    .update({ accounting_sync_status: 'pending' })
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)

  try {
    const provider = await getAccountingProvider(supabase, tenantId)

    if (invoice.direction === 'outbound') {
      // AR Invoice flow
      const { invoice: accountingInvoice, contact, contactSourceId, contactSourceType } =
        await mapIrcInvoiceToAccounting(supabase, tenantId, invoiceId)

      // Upsert contact
      const contactId = await provider.upsertContact(contact)

      // Save contact ID back to source record
      if (contactSourceType === 'client') {
        await supabase
          .from('clients')
          .update({ accounting_contact_id: contactId })
          .eq('id', contactSourceId)
          .eq('tenant_id', tenantId)
      } else if (contactSourceType === 'job_homeowner') {
        await supabase
          .from('jobs')
          .update({ homeowner_accounting_contact_id: contactId })
          .eq('id', contactSourceId)
          .eq('tenant_id', tenantId)
      }

      // Create invoice
      const accountingRefId = await provider.createInvoice(accountingInvoice, contactId)

      // Update invoice with sync result
      await supabase
        .from('invoices')
        .update({
          accounting_ref_id: accountingRefId,
          accounting_sync_status: 'synced',
          accounting_sync_error: null,
          accounting_last_synced_at: new Date().toISOString(),
        })
        .eq('id', invoiceId)
        .eq('tenant_id', tenantId)

      return { success: true, accountingRefId }
    } else if (invoice.direction === 'inbound') {
      // AP Bill flow
      const { bill, contact, tradeId } = await mapIrcBillToAccounting(
        supabase,
        tenantId,
        invoiceId
      )

      // Upsert vendor contact
      const vendorId = await provider.upsertContact(contact)

      // Save vendor ID back to trade
      await supabase
        .from('trades')
        .update({ accounting_contact_id: vendorId })
        .eq('id', tradeId)
        .eq('tenant_id', tenantId)

      // Create bill
      const billId = await provider.createBill(bill, vendorId)

      // Update invoice with sync result
      await supabase
        .from('invoices')
        .update({
          accounting_bill_id: billId,
          accounting_sync_status: 'synced',
          accounting_sync_error: null,
          accounting_last_synced_at: new Date().toISOString(),
        })
        .eq('id', invoiceId)
        .eq('tenant_id', tenantId)

      return { success: true, accountingRefId: billId }
    } else {
      // Unknown direction — not applicable
      await supabase
        .from('invoices')
        .update({
          accounting_sync_status: 'not_applicable',
          accounting_last_synced_at: new Date().toISOString(),
        })
        .eq('id', invoiceId)
        .eq('tenant_id', tenantId)

      return {
        success: false,
        error: `Unknown invoice direction: ${invoice.direction}`,
      }
    }
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : 'Unknown sync error'
    await markSyncFailed(supabase, tenantId, invoiceId, errorMessage)
    return { success: false, error: errorMessage }
  }
}
