import { NextRequest, NextResponse } from 'next/server'
import { permissionDenied, permissionGate } from '@/lib/permissions/http'
import { recordOperation } from '@/lib/activity/log'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'
import { InvoiceEditError, updateInvoice } from '@/lib/invoices/edit'
import { InvoiceVoidError, voidInvoice } from '@/lib/invoices/void'

interface Params {
  params: Promise<{ invoiceId: string }>
}

export async function GET(req: NextRequest, { params }: Params) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const { invoiceId } = await params
  const tenantId = me.tenantId

  const supabase = createServiceClient()

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .single()

  if (error || !invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  const { data: lineItems } = await supabase
    .from('invoice_line_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })

  return NextResponse.json({ invoice, lineItems: lineItems ?? [] })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const denied = await permissionDenied(me.tenantId, me.userId, 'invoices.manage')
  if (denied) return denied
  const { invoiceId } = await params
  const body = await req.json() as {
    tenantId: string
    status?: string
    issued_date?: string
    notes?: string
  }

  console.log(`[invoice-patch] PATCH hit — invoiceId=${invoiceId} body=${JSON.stringify(body)}`)

  const { tenantId: _clientTenantId, ...updates } = body

  try {
    const invoice = await updateInvoice(createServiceClient(), me.tenantId, invoiceId, updates)
    return NextResponse.json({ invoice })
  } catch (err) {
    if (err instanceof InvoiceEditError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}

// The Void button: the invoice stays, voided, with who, when and why
// (lib/invoices/void.ts — also voids it in the accounting system).
export async function DELETE(req: NextRequest, { params }: Params) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const { invoiceId } = await params
  const body = await req.json().catch(() => ({})) as { reason?: unknown }
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) : ''

  const gated = await permissionGate(me.tenantId, me.userId, 'invoices.manage', { operation: 'invoice.void', payload: { invoiceId, reason } })
  if (gated) return gated

  try {
    const result = await voidInvoice(createServiceClient(), me.tenantId, invoiceId, { reason, userId: me.userId })
    await recordOperation({
      tenantId: me.tenantId, userId: me.userId, action: 'invoices.manage', operation: 'invoice.void', payload: { invoiceId, reason },
      detail: [`Voided ${result.invoice.invoice_ref ?? 'invoice'}.`, ...result.warnings].join(' '),
    })
    return NextResponse.json({ success: true, accounting: result.accounting, adjusted: result.adjusted, warnings: result.warnings })
  } catch (err) {
    if (err instanceof InvoiceVoidError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}
