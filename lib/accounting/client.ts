import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AccountingProvider_Interface,
  AccountingInvoice,
  AccountingBill,
  AccountingContact,
  ChartOfAccountsItem,
  PaymentStatusResult,
} from './types'
import { createQboInvoice } from './providers/quickbooks/invoices'
import { createQboBill } from './providers/quickbooks/bills'
import { upsertQboContact } from './providers/quickbooks/contacts'
import { getQboAccounts } from './providers/quickbooks/accounts'
import { pollQboPayments } from './providers/quickbooks/poll'
import { refreshQboTokens } from './providers/quickbooks/client'

interface AutomationConfigRow {
  key: string
  value: string
}

interface AccountingCredentialsRow {
  id: string
  tenant_id: string
  provider: string
  realm_id: string
  access_token: string
  refresh_token: string
  token_expires_at: string
  refresh_expires_at: string
}

class QuickBooksProvider implements AccountingProvider_Interface {
  private supabase: SupabaseClient
  private tenantId: string

  constructor(supabase: SupabaseClient, tenantId: string) {
    this.supabase = supabase
    this.tenantId = tenantId
  }

  async createInvoice(
    invoice: AccountingInvoice,
    contactId: string
  ): Promise<string> {
    return createQboInvoice(this.supabase, this.tenantId, invoice, contactId)
  }

  async createBill(
    bill: AccountingBill,
    vendorId: string
  ): Promise<string> {
    return createQboBill(this.supabase, this.tenantId, bill, vendorId)
  }

  async upsertContact(contact: AccountingContact): Promise<string> {
    return upsertQboContact(this.supabase, this.tenantId, contact)
  }

  async getChartOfAccounts(): Promise<ChartOfAccountsItem[]> {
    return getQboAccounts(this.supabase, this.tenantId)
  }

  async pollPaymentStatus(
    accountingRefIds: string[]
  ): Promise<PaymentStatusResult[]> {
    return pollQboPayments(this.supabase, this.tenantId, accountingRefIds)
  }

  async refreshAccessToken(): Promise<void> {
    const { data: rawCreds, error } = await this.supabase
      .from('accounting_credentials')
      .select('*')
      .eq('tenant_id', this.tenantId)
      .eq('provider', 'quickbooks')
      .single()

    if (error || !rawCreds) {
      throw new Error(
        `No QuickBooks credentials for tenant ${this.tenantId}: ${error?.message}`
      )
    }

    await refreshQboTokens(
      this.supabase,
      this.tenantId,
      rawCreds as AccountingCredentialsRow
    )
  }
}

export async function getAccountingProvider(
  supabase: SupabaseClient,
  tenantId: string
): Promise<AccountingProvider_Interface> {
  const { data } = await supabase
    .from('automation_config')
    .select('key, value')
    .eq('tenant_id', tenantId)
    .eq('key', 'accounting_provider')
    .single()

  const row = data as AutomationConfigRow | null
  const provider = row?.value ?? 'quickbooks'

  // Currently only QuickBooks is supported; Xero can be added here later
  if (provider === 'quickbooks' || provider !== 'xero') {
    return new QuickBooksProvider(supabase, tenantId)
  }

  // Fallback — default to QuickBooks
  return new QuickBooksProvider(supabase, tenantId)
}
