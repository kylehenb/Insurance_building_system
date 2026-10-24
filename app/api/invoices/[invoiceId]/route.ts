import { NextRequest, NextResponse } from 'next/server'
import { permissionDenied } from '@/lib/permissions/http'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'
import { InvoiceEditError, updateInvoice } from '@/lib/invoices/edit'

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

export async function DELETE(req: NextRequest, { params }: Params) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const denied = await permissionDenied(me.tenantId, me.userId, 'invoices.manage')
  if (denied) return denied
  const { invoiceId } = await params
  const tenantId = me.tenantId

  const supabase = createServiceClient()

  const { error } = await supabase
    .from('invoices')
    .update({ status: 'voided' })
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
