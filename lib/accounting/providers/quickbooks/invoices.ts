import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountingInvoice } from '../../types'
import { qboFetch } from './client'
import { getQboGstTaxCodeId } from './taxcodes'

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
    TaxCodeRef: {
      value: string
    }
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
  GlobalTaxCalculation: 'TaxExcluded'
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
  const gstCodeId = await getQboGstTaxCodeId(supabase, tenantId)

  const lines: QboInvoiceLine[] = invoice.lineItems.map((item) => {
    // unit_price/quantity may be null/0 in invoice_line_items — only line_total is
    // guaranteed to be populated. When unit_price is absent, model the line as
    // qty=1 at line_total price so QBO's Amount === UnitPrice * Qty check passes.
    const hasUnitPrice = item.unitPrice != null && item.unitPrice !== 0
    const qty = hasUnitPrice ? item.quantity : 1
    const unitPrice = hasUnitPrice ? item.unitPrice : item.lineTotal
    const amount = Math.round(unitPrice * qty * 100) / 100
    console.log(
      `[qbo-invoice] line — raw unitPrice=${item.unitPrice} qty=${item.quantity} lineTotal=${item.lineTotal} → sending UnitPrice=${unitPrice} Qty=${qty} Amount=${amount}`
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
        Qty: qty,
        UnitPrice: unitPrice,
        TaxCodeRef: {
          value: gstCodeId,
        },
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
    GlobalTaxCalculation: 'TaxExcluded',
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
