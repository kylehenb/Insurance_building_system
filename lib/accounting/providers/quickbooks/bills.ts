import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountingBill } from '../../types'
import { qboFetch } from './client'

interface QboBillLine {
  DetailType: 'ItemBasedExpenseLineDetail'
  Amount: number
  Description: string
  ItemBasedExpenseLineDetail: {
    ItemRef: {
      value: string
      name: string
    }
    Qty: number
    UnitPrice: number
  }
}

interface QboBillPayload {
  VendorRef: {
    value: string
  }
  DocNumber: string | null
  TxnDate: string
  DueDate: string
  Line: QboBillLine[]
  CurrencyRef: {
    value: string
  }
}

interface QboBillCreateResponse {
  Bill: {
    Id: string
    DocNumber: string | null
  }
}

export async function createQboBill(
  supabase: SupabaseClient,
  tenantId: string,
  bill: AccountingBill,
  vendorId: string
): Promise<string> {
  const lines: QboBillLine[] = bill.lineItems.map((item) => {
    const hasUnitPrice = item.unitPrice != null && item.unitPrice !== 0
    const qty = hasUnitPrice ? item.quantity : 1
    const unitPrice = hasUnitPrice ? item.unitPrice : item.lineTotal
    const amount = Math.round(unitPrice * qty * 100) / 100
    return {
      DetailType: 'ItemBasedExpenseLineDetail',
      Amount: amount,
      Description: item.description,
      ItemBasedExpenseLineDetail: {
        ItemRef: {
          value: item.accountId,
          name: item.accountName,
        },
        Qty: qty,
        UnitPrice: unitPrice,
      },
    }
  })

  const payload: QboBillPayload = {
    VendorRef: {
      value: vendorId,
    },
    DocNumber: bill.tradeInvoiceNumber,
    TxnDate: bill.issuedDate,
    DueDate: bill.dueDate,
    CurrencyRef: {
      value: bill.currency,
    },
    Line: lines,
  }

  const res = await qboFetch(supabase, tenantId, '/bill', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const tid = res.headers.get('intuit_tid') ?? 'unavailable'
    const errBody = await res.text()
    throw new Error(`Failed to create QBO bill: ${res.status} ${errBody} [intuit_tid=${tid}]`)
  }

  const data = (await res.json()) as QboBillCreateResponse
  return data.Bill.Id
}
