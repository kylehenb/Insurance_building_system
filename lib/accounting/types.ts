import type { SupabaseClient } from '@supabase/supabase-js'

export type AccountingProvider = 'quickbooks' | 'xero'

export type AccountingSyncStatus = 'pending' | 'synced' | 'failed' | 'not_applicable'

export type IrcCategory =
  | 'bar_report'
  | 'roof_report'
  | 'make_safe'
  | 'repair_works'
  | 'excess_recovery'
  | 'specialist_report'
  | 'leak_detection_report'
  | 'trade_cost'
  | 'other'

export interface AccountingContact {
  displayName: string
  email: string | null
  phone: string | null
  companyName: string | null
  abn: string | null
  isVendor: boolean
  existingAccountingId: string | null
}

export interface AccountingLineItem {
  description: string
  quantity: number
  unitPrice: number
  lineTotal: number
  accountId: string
  accountName: string
  taxCode: string
}

export interface AccountingInvoice {
  ircInvoiceRef: string
  issuedDate: string
  dueDate: string
  lineItems: AccountingLineItem[]
  amountExGst: number
  gst: number
  amountIncGst: number
  currency: string
}

export interface AccountingBill {
  tradeInvoiceNumber: string | null
  issuedDate: string
  dueDate: string
  lineItems: AccountingLineItem[]
  amountExGst: number
  gst: number
  amountIncGst: number
  currency: string
}

export interface AccountingCredentials {
  id: string
  tenantId: string
  provider: AccountingProvider
  realmId: string
  accessToken: string
  refreshToken: string
  tokenExpiresAt: string
  refreshExpiresAt: string
}

export interface ChartOfAccountsItem {
  id: string
  name: string
  accountType: string
  accountSubType: string | null
  code: string | null
}

export interface PaymentStatusResult {
  accountingRefId: string
  isPaid: boolean
  paidDate: string | null
}

export interface AccountingProvider_Interface {
  createInvoice(
    invoice: AccountingInvoice,
    contactId: string
  ): Promise<string>

  createBill(
    bill: AccountingBill,
    vendorId: string
  ): Promise<string>

  upsertContact(
    contact: AccountingContact
  ): Promise<string>

  getChartOfAccounts(): Promise<ChartOfAccountsItem[]>

  pollPaymentStatus(
    accountingRefIds: string[]
  ): Promise<PaymentStatusResult[]>

  refreshAccessToken(): Promise<void>
}

export interface AccountingProviderConstructor {
  new (supabase: SupabaseClient, tenantId: string): AccountingProvider_Interface
}
