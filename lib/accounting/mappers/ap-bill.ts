import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountingBill, AccountingContact, AccountingLineItem } from '../types'

interface InvoiceRow {
  id: string
  tenant_id: string
  job_id: string
  trade_id: string | null
  invoice_type: string
  direction: string
  trade_invoice_number: string | null
  amount_ex_gst: number
  gst: number
  amount_inc_gst: number
  issued_date: string | null
}

interface LineItemRow {
  id: string
  tenant_id: string
  invoice_id: string
  description: string
  quantity: number
  unit_price: number
  line_total: number
}

interface TradeRow {
  id: string
  tenant_id: string
  business_name: string
  entity_name: string | null
  abn: string | null
  contact_email: string | null
  contact_mobile: string | null
  primary_contact: string | null
  accounting_contact_id: string | null
}

interface AccountMapRow {
  accounting_account_id: string
  accounting_account_name: string
}

export async function mapIrcBillToAccounting(
  supabase: SupabaseClient,
  tenantId: string,
  invoiceId: string
): Promise<{
  bill: AccountingBill
  contact: AccountingContact
  tradeId: string
}> {
  // 1. Fetch invoice
  const { data: invoiceData, error: invoiceError } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .single()

  if (invoiceError || !invoiceData) {
    throw new Error(`Invoice not found: ${invoiceError?.message}`)
  }

  const invoice = invoiceData as InvoiceRow

  if (!invoice.trade_id) {
    throw new Error(`Invoice ${invoiceId} has no associated trade`)
  }

  // 2. Fetch trade
  const { data: tradeData, error: tradeError } = await supabase
    .from('trades')
    .select('*')
    .eq('id', invoice.trade_id)
    .eq('tenant_id', tenantId)
    .single()

  if (tradeError || !tradeData) {
    throw new Error(`Trade not found: ${tradeError?.message}`)
  }

  const trade = tradeData as TradeRow

  // 3. Fetch line items
  const { data: lineItemsData, error: lineItemsError } = await supabase
    .from('invoice_line_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .eq('tenant_id', tenantId)

  if (lineItemsError) {
    throw new Error(`Failed to fetch line items: ${lineItemsError.message}`)
  }

  const lineItems = (lineItemsData ?? []) as LineItemRow[]

  // 4. Look up account map for trade_cost
  const { data: accountMapData } = await supabase
    .from('accounting_account_map')
    .select('accounting_account_id, accounting_account_name')
    .eq('tenant_id', tenantId)
    .eq('irc_category', 'trade_cost')
    .single()

  const accountMap = accountMapData as AccountMapRow | null
  const defaultAccountId = accountMap?.accounting_account_id ?? '1'
  const defaultAccountName = accountMap?.accounting_account_name ?? 'Cost of Goods Sold'

  // 5. Build line items
  const mappedLineItems: AccountingLineItem[] = lineItems.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unit_price,
    lineTotal: item.line_total,
    accountId: defaultAccountId,
    accountName: defaultAccountName,
  }))

  // 6. Calculate due date (today + 30 days)
  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + 30)
  const dueDateStr = dueDate.toISOString().split('T')[0]

  // 7. Build contact
  const contact: AccountingContact = {
    displayName: trade.business_name,
    email: trade.contact_email ?? null,
    phone: trade.contact_mobile ?? null,
    companyName: trade.entity_name ?? trade.business_name,
    abn: trade.abn ?? null,
    isVendor: true,
    existingAccountingId: trade.accounting_contact_id ?? null,
  }

  const bill: AccountingBill = {
    tradeInvoiceNumber: invoice.trade_invoice_number ?? null,
    issuedDate: invoice.issued_date ?? new Date().toISOString().split('T')[0],
    dueDate: dueDateStr,
    lineItems: mappedLineItems,
    amountExGst: invoice.amount_ex_gst,
    gst: invoice.gst,
    amountIncGst: invoice.amount_inc_gst,
    currency: 'AUD',
  }

  return {
    bill,
    contact,
    tradeId: trade.id,
  }
}
