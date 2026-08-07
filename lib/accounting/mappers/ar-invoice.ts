import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountingInvoice, AccountingContact, AccountingLineItem } from '../types'
import { mapInvoiceTypeToCategory } from '../category-mapper'

interface InvoiceRow {
  id: string
  tenant_id: string
  job_id: string
  invoice_type: string
  direction: string
  invoice_ref: string
  status: string
  amount_ex_gst: number
  gst: number
  amount_inc_gst: number
  issued_date: string
  paid_date: string | null
  trade_invoice_number: string | null
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

interface JobRow {
  id: string
  tenant_id: string
  client_id: string
  insured_name: string | null
  insured_email: string | null
  insured_phone: string | null
  homeowner_accounting_contact_id: string | null
}

interface ClientRow {
  id: string
  tenant_id: string
  name: string
  submission_email: string | null
  contact_phone: string | null
  abn: string | null
  accounting_contact_id: string | null
}

interface TenantRow {
  id: string
  invoice_payment_terms: number | null
}

interface AccountMapRow {
  accounting_account_id: string
  accounting_account_name: string
}

export async function mapIrcInvoiceToAccounting(
  supabase: SupabaseClient,
  tenantId: string,
  invoiceId: string
): Promise<{
  invoice: AccountingInvoice
  contact: AccountingContact
  contactSourceId: string
  contactSourceType: 'client' | 'job_homeowner'
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

  // 2. Fetch line items
  const { data: lineItemsData, error: lineItemsError } = await supabase
    .from('invoice_line_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .eq('tenant_id', tenantId)

  if (lineItemsError) {
    throw new Error(`Failed to fetch line items: ${lineItemsError.message}`)
  }

  const lineItems = (lineItemsData ?? []) as LineItemRow[]

  // 3. Fetch job
  const { data: jobData, error: jobError } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', invoice.job_id)
    .eq('tenant_id', tenantId)
    .single()

  if (jobError || !jobData) {
    throw new Error(`Job not found: ${jobError?.message}`)
  }

  const job = jobData as JobRow

  // 4. Determine contact source
  const isExcessType =
    invoice.invoice_type === 'excess' || invoice.invoice_type === 'excess_recovery'

  let contact: AccountingContact
  let contactSourceId: string
  let contactSourceType: 'client' | 'job_homeowner'

  if (isExcessType) {
    // Use homeowner (insured) as contact
    contactSourceType = 'job_homeowner'
    contactSourceId = job.id
    contact = {
      displayName: job.insured_name ?? 'Homeowner',
      email: job.insured_email ?? null,
      phone: job.insured_phone ?? null,
      companyName: null,
      abn: null,
      isVendor: false,
      existingAccountingId: job.homeowner_accounting_contact_id ?? null,
    }
  } else {
    // Use client as contact
    contactSourceType = 'client'
    contactSourceId = job.client_id

    const { data: clientData, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('id', job.client_id)
      .eq('tenant_id', tenantId)
      .single()

    if (clientError || !clientData) {
      throw new Error(`Client not found: ${clientError?.message}`)
    }

    const client = clientData as ClientRow
    contact = {
      displayName: client.name,
      email: client.submission_email ?? null,
      phone: client.contact_phone ?? null,
      companyName: client.name,
      abn: client.abn ?? null,
      isVendor: false,
      existingAccountingId: client.accounting_contact_id ?? null,
    }
  }

  // 5. Fetch tenant for payment terms
  const { data: tenantData, error: tenantError } = await supabase
    .from('tenants')
    .select('id, invoice_payment_terms')
    .eq('id', tenantId)
    .single()

  if (tenantError) {
    console.warn(
      `[ar-invoice] Failed to fetch tenant payment terms for tenant ${tenantId}:`,
      tenantError.message
    )
  }

  const tenant = tenantData as TenantRow | null
  const paymentTermsDays = tenant?.invoice_payment_terms ?? 14

  // 6. Calculate due date
  const issuedDate = invoice.issued_date
    ? new Date(invoice.issued_date)
    : new Date()
  const dueDate = new Date(issuedDate)
  dueDate.setDate(dueDate.getDate() + paymentTermsDays)
  const dueDateStr = dueDate.toISOString().split('T')[0]

  // 7. Look up account map and build line items
  const category = mapInvoiceTypeToCategory(invoice.invoice_type)

  const { data: accountMapData } = await supabase
    .from('accounting_account_map')
    .select('accounting_account_id, accounting_account_name')
    .eq('tenant_id', tenantId)
    .eq('irc_category', category)
    .single()

  const accountMap = accountMapData as AccountMapRow | null
  const defaultAccountId = accountMap?.accounting_account_id ?? '1'
  const defaultAccountName = accountMap?.accounting_account_name ?? 'Income'

  const mappedLineItems: AccountingLineItem[] = lineItems.map((item) => {
    console.log(
      `[ar-invoice] raw line item — unit_price=${item.unit_price} quantity=${item.quantity} line_total=${item.line_total} desc="${item.description}"`
    )
    return {
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      lineTotal: item.line_total,  // GST-exclusive; confirmed by invoice.amount_ex_gst = sum(line_total)
      accountId: defaultAccountId,
      accountName: defaultAccountName,
      taxCode: 'GST',
    }
  })

  const accountingInvoice: AccountingInvoice = {
    ircInvoiceRef: invoice.invoice_ref,
    issuedDate: invoice.issued_date ?? new Date().toISOString().split('T')[0],
    dueDate: dueDateStr,
    lineItems: mappedLineItems,
    amountExGst: invoice.amount_ex_gst,
    gst: invoice.gst,
    amountIncGst: invoice.amount_inc_gst,
    currency: 'AUD',
  }

  return {
    invoice: accountingInvoice,
    contact,
    contactSourceId,
    contactSourceType,
  }
}
