import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChartOfAccountsItem } from '../../types'
import { qboFetch } from './client'

interface QboItemRow {
  Id: string
  Name: string
  FullyQualifiedName: string
  Type: string
  Active: boolean
  Sku: string | null
}

interface QboItemQueryResponse {
  QueryResponse: {
    Item?: QboItemRow[]
    totalCount?: number
  }
}

const ALLOWED_ITEM_TYPES = new Set(['Service', 'NonInventory'])

export async function getQboAccounts(
  supabase: SupabaseClient,
  tenantId: string
): Promise<ChartOfAccountsItem[]> {
  const query = encodeURIComponent(
    'SELECT * FROM Item WHERE Active = true MAXRESULTS 200'
  )

  const res = await qboFetch(supabase, tenantId, `/query?query=${query}`)

  if (!res.ok) {
    const tid = res.headers.get('intuit_tid') ?? 'unavailable'
    const errBody = await res.text()
    throw new Error(`Failed to fetch QBO items: ${res.status} ${errBody} [intuit_tid=${tid}]`)
  }

  const data = (await res.json()) as QboItemQueryResponse
  const items = data.QueryResponse.Item ?? []

  return items
    .filter((item) => ALLOWED_ITEM_TYPES.has(item.Type))
    .map((item) => ({
      id: item.Id,
      name: item.FullyQualifiedName || item.Name,
      accountType: item.Type,
      accountSubType: null,
      code: item.Sku ?? null,
    }))
}
