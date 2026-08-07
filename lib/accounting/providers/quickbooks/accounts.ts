import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChartOfAccountsItem } from '../../types'
import { qboFetch } from './client'

interface QboAccountRow {
  Id: string
  Name: string
  AccountType: string
  AccountSubType: string | null
  AcctNum: string | null
  Active: boolean
}

interface QboAccountQueryResponse {
  QueryResponse: {
    Account?: QboAccountRow[]
    totalCount?: number
  }
}

const ALLOWED_ACCOUNT_TYPES = new Set([
  'Income',
  'OtherIncome',
  'CostOfGoodsSold',
  'Expense',
  'OtherExpense',
])

export async function getQboAccounts(
  supabase: SupabaseClient,
  tenantId: string
): Promise<ChartOfAccountsItem[]> {
  const query = encodeURIComponent(
    'SELECT * FROM Account WHERE Active = true MAXRESULTS 200'
  )

  const res = await qboFetch(supabase, tenantId, `/query?query=${query}`)

  if (!res.ok) {
    const tid = res.headers.get('intuit_tid') ?? 'unavailable'
    const errBody = await res.text()
    throw new Error(`Failed to fetch QBO accounts: ${res.status} ${errBody} [intuit_tid=${tid}]`)
  }

  const data = (await res.json()) as QboAccountQueryResponse
  const accounts = data.QueryResponse.Account ?? []

  return accounts
    .filter((account) => ALLOWED_ACCOUNT_TYPES.has(account.AccountType))
    .map((account) => ({
      id: account.Id,
      name: account.Name,
      accountType: account.AccountType,
      accountSubType: account.AccountSubType ?? null,
      code: account.AcctNum ?? null,
    }))
}
