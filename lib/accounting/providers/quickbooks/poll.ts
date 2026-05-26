import type { SupabaseClient } from '@supabase/supabase-js'
import type { PaymentStatusResult } from '../../types'
import { qboFetch } from './client'

interface QboInvoiceRow {
  Id: string
  Balance: number
  TxnDate: string
}

interface QboInvoiceQueryResponse {
  QueryResponse: {
    Invoice?: QboInvoiceRow[]
    totalCount?: number
  }
}

export async function pollQboPayments(
  supabase: SupabaseClient,
  tenantId: string,
  accountingRefIds: string[]
): Promise<PaymentStatusResult[]> {
  if (accountingRefIds.length === 0) {
    return []
  }

  // QBO query supports IN clause — batch in groups of 50 to stay within URL limits
  const results: PaymentStatusResult[] = []
  const chunkSize = 50

  for (let i = 0; i < accountingRefIds.length; i += chunkSize) {
    const chunk = accountingRefIds.slice(i, i + chunkSize)
    const idList = chunk.map((id) => `'${id}'`).join(', ')
    const query = encodeURIComponent(
      `SELECT Id, Balance, TxnDate FROM Invoice WHERE Id IN (${idList})`
    )

    const res = await qboFetch(supabase, tenantId, `/query?query=${query}`)

    if (!res.ok) {
      const errBody = await res.text()
      throw new Error(`Failed to poll QBO payments: ${res.status} ${errBody}`)
    }

    const data = (await res.json()) as QboInvoiceQueryResponse
    const invoices = data.QueryResponse.Invoice ?? []

    for (const invoice of invoices) {
      const isPaid = invoice.Balance === 0
      results.push({
        accountingRefId: invoice.Id,
        isPaid,
        paidDate: isPaid ? new Date().toISOString().split('T')[0] : null,
      })
    }

    // For any IDs not returned by QBO (deleted / not found), mark as not paid
    const returnedIds = new Set(invoices.map((inv) => inv.Id))
    for (const id of chunk) {
      if (!returnedIds.has(id)) {
        results.push({
          accountingRefId: id,
          isPaid: false,
          paidDate: null,
        })
      }
    }
  }

  return results
}
