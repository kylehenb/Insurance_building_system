import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'

type InvoiceUpdate = Database['public']['Tables']['invoices']['Update']

interface Params {
  params: Promise<{ invoiceId: string }>
}

export async function GET(req: NextRequest, { params }: Params) {
  const { invoiceId } = await params
  const tenantId = req.nextUrl.searchParams.get('tenantId')

  if (!tenantId) {
    return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 })
  }

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
  const { invoiceId } = await params
  const body = await req.json() as {
    tenantId: string
    status?: string
    issued_date?: string
    notes?: string
  }

  const { tenantId, ...updates } = body

  if (!tenantId) {
    return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const allowedFields: InvoiceUpdate = {}
  if ('status' in updates) allowedFields.status = updates.status
  if ('issued_date' in updates) allowedFields.issued_date = updates.issued_date
  if ('notes' in updates) allowedFields.notes = updates.notes

  const { data: invoice, error } = await supabase
    .from('invoices')
    .update(allowedFields)
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .select('*')
    .single()

  if (error || !invoice) {
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ invoice })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { invoiceId } = await params
  const body = await req.json() as { tenantId: string }
  const { tenantId } = body

  if (!tenantId) {
    return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 })
  }

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
