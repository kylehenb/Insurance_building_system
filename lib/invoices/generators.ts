import type { Database } from '@/lib/supabase/database.types'

type InvoiceInsert = Database['public']['Tables']['invoices']['Insert']
type LineItemInsert = Database['public']['Tables']['invoice_line_items']['Insert']

export interface GeneratedInvoice {
  invoiceData: Omit<InvoiceInsert, 'id' | 'created_at'>
  lineItems: Omit<LineItemInsert, 'id' | 'created_at' | 'invoice_id'>[]
}

export function generateAssessmentInvoice(params: {
  tenantId: string
  jobId: string
  reportId: string
  jobRef: string
  claimNumber: string | null
  standardCharge: number
  gstPct: number
}): GeneratedInvoice {
  const amountExGst = params.standardCharge
  const gst = Math.round(amountExGst * params.gstPct * 100) / 100
  const amountIncGst = Math.round((amountExGst + gst) * 100) / 100

  return {
    invoiceData: {
      tenant_id: params.tenantId,
      job_id: params.jobId,
      report_id: params.reportId,
      invoice_type: 'assessment',
      direction: 'outbound',
      gst_treatment: 'exclusive',
      amount_ex_gst: amountExGst,
      gst,
      amount_inc_gst: amountIncGst,
      status: 'draft',
    },
    lineItems: [
      {
        tenant_id: params.tenantId,
        description: `Building Assessment Report${params.claimNumber ? ` — Claim ${params.claimNumber}` : ''}`,
        quantity: 1,
        unit_price: amountExGst,
        line_total: amountExGst,
        sort_order: 0,
      },
    ],
  }
}

export function generateExcessInvoice(params: {
  tenantId: string
  jobId: string
  claimNumber: string | null
  insuredName: string | null
  excessAmountIncGst: number
  gstPct: number
}): GeneratedInvoice {
  const amountIncGst = Math.round(params.excessAmountIncGst * 100) / 100
  const amountExGst = Math.round((amountIncGst / (1 + params.gstPct)) * 100) / 100
  const gst = Math.round((amountIncGst - amountExGst) * 100) / 100

  return {
    invoiceData: {
      tenant_id: params.tenantId,
      job_id: params.jobId,
      invoice_type: 'repair',
      direction: 'outbound',
      gst_treatment: 'inclusive',
      amount_ex_gst: amountExGst,
      gst,
      amount_inc_gst: amountIncGst,
      status: 'draft',
    },
    lineItems: [
      {
        tenant_id: params.tenantId,
        description: `Policy Excess${params.claimNumber ? ` — Claim ${params.claimNumber}` : ''}${params.insuredName ? ` — ${params.insuredName}` : ''}`,
        quantity: 1,
        unit_price: amountExGst,
        line_total: amountExGst,
        sort_order: 0,
      },
    ],
  }
}

export function generateBalanceInvoice(params: {
  tenantId: string
  jobId: string
  claimNumber: string | null
  approvedQuoteAmountIncGst: number
  previouslyInvoicedAmountIncGst: number
  gstPct: number
}): GeneratedInvoice {
  const balanceIncGst = Math.round(
    (params.approvedQuoteAmountIncGst - params.previouslyInvoicedAmountIncGst) * 100
  ) / 100
  const balanceExGst = Math.round((balanceIncGst / (1 + params.gstPct)) * 100) / 100
  const gst = Math.round((balanceIncGst - balanceExGst) * 100) / 100

  return {
    invoiceData: {
      tenant_id: params.tenantId,
      job_id: params.jobId,
      invoice_type: 'repair',
      direction: 'outbound',
      gst_treatment: 'exclusive',
      amount_ex_gst: balanceExGst,
      gst,
      amount_inc_gst: balanceIncGst,
      status: 'draft',
    },
    lineItems: [
      {
        tenant_id: params.tenantId,
        description: `Balance of Works${params.claimNumber ? ` — Claim ${params.claimNumber}` : ''}`,
        quantity: 1,
        unit_price: balanceExGst,
        line_total: balanceExGst,
        sort_order: 0,
      },
    ],
  }
}

export function generateMakeSafeInvoice(params: {
  tenantId: string
  jobId: string
  workOrderId: string
  claimNumber: string | null
  lineItems: Array<{ description: string; quantity: number; unitPrice: number; unit?: string; libraryItemId?: string }>
  gstPct: number
}): GeneratedInvoice {
  const lineItemsWithTotals = params.lineItems.map((item, i) => ({
    tenant_id: params.tenantId,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit ?? null,
    unit_price: item.unitPrice,
    line_total: Math.round(item.quantity * item.unitPrice * 100) / 100,
    library_item_id: item.libraryItemId ?? null,
    sort_order: i,
  }))

  const amountExGst = Math.round(lineItemsWithTotals.reduce((sum, li) => sum + li.line_total, 0) * 100) / 100
  const gst = Math.round(amountExGst * params.gstPct * 100) / 100
  const amountIncGst = Math.round((amountExGst + gst) * 100) / 100

  return {
    invoiceData: {
      tenant_id: params.tenantId,
      job_id: params.jobId,
      work_order_id: params.workOrderId,
      invoice_type: 'make_safe',
      direction: 'outbound',
      gst_treatment: 'exclusive',
      amount_ex_gst: amountExGst,
      gst,
      amount_inc_gst: amountIncGst,
      status: 'draft',
    },
    lineItems: lineItemsWithTotals,
  }
}
