import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountingInvoice } from '../../types'
import { qboFetch } from './client'

interface QboInvoiceLine {
  DetailType: 'SalesItemLineDetail'
  Amount: number
  Description: string
  SalesItemLineDetail: {
    ItemRef: {
      value: string
      name: string
    }
    Qty: number
    UnitPrice: number
  }
}

interface QboInvoicePayload {
  CustomerRef: {
    value: string
  }
  DocNumber: string
  TxnDate: string
  DueDate: string
  CurrencyRef: {
    value: string
  }
  Line: QboInvoiceLine[]
}

interface QboInvoiceCreateResponse {
  Invoice: {
    Id: string
    DocNumber: string
  }
}

export async function createQboInvoice(
  supabase: SupabaseClient,
  tenantId: string,
  invoice: AccountingInvoice,
  contactId: string
): Promise<string> {
  const lines: QboInvoiceLine[] = invoice.lineItems.map((item) => {
    // QBO requires Amount === UnitPrice * Qty exactly. Derive Amount from the
    // same fields QBO will use for validation rather than using lineTotal
    // (which may be GST-inclusive or rounded differently).
    const amount = Math.round(item.unitPrice * item.quantity * 100) / 100
    console.log(
      `[qbo-invoice] line — UnitPrice=${item.unitPrice} Qty=${item.quantity} Amount=${amount} (lineTotal in DB=${item.lineTotal})`
    )
    return {
      DetailType: 'SalesItemLineDetail',
      Amount: amount,
      Description: item.description,
      SalesItemLineDetail: {
        ItemRef: {
          value: item.accountId,
          name: item.accountName,
        },
        Qty: item.quantity,
        UnitPrice: item.unitPrice,
      },
    }
  })

  const payload: QboInvoicePayload = {
    CustomerRef: {
      value: contactId,
    },
    DocNumber: invoice.ircInvoiceRef,
    TxnDate: invoice.issuedDate,
    DueDate: invoice.dueDate,
    CurrencyRef: {
      value: invoice.currency,
    },
    Line: lines,
  }

  const res = await qboFetch(supabase, tenantId, '/invoice', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`Failed to create QBO invoice: ${res.status} ${errBody}`)
  }

  const data = (await res.json()) as QboInvoiceCreateResponse
  return data.Invoice.Id
}
