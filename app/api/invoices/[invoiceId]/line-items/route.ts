import { NextRequest, NextResponse } from 'next/server'
import { permissionDenied } from '@/lib/permissions/http'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'
import { InvoiceEditError, addInvoiceLine } from '@/lib/invoices/edit'

interface Params {
  params: Promise<{ invoiceId: string }>
}

export async function GET(req: NextRequest, { params }: Params) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const { invoiceId } = await params
  const tenantId = me.tenantId

  const supabase = createServiceClient()

  const { data: lineItems, error } = await supabase
    .from('invoice_line_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(lineItems ?? [])
}

export async function POST(req: NextRequest, { params }: Params) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const denied = await permissionDenied(me.tenantId, me.userId, 'invoices.manage')
  if (denied) return denied
  const { invoiceId } = await params
  const body = await req.json() as {
    tenantId: string
    description: string
    quantity: number
    unit_price: number
    unit?: string
    library_item_id?: string
  }

  const { description, quantity, unit_price, unit, library_item_id } = body

  try {
    const lineItem = await addInvoiceLine(createServiceClient(), me.tenantId, invoiceId, { description, quantity, unit_price, unit, library_item_id })
    return NextResponse.json(lineItem, { status: 201 })
  } catch (err) {
    if (err instanceof InvoiceEditError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}
