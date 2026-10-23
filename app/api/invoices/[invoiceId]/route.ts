import { NextRequest, NextResponse } from 'next/server'
import { permissionDenied } from '@/lib/permissions/http'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'
import { syncInvoiceToAccounting } from '@/lib/accounting/sync'

type InvoiceUpdate = Database['public']['Tables']['invoices']['Update']

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
  const tenantId = me.tenantId

  const supabase = createServiceClient()

  // Capture previous status up front — needed both to detect a transition to 'sent'
  // and to guard the invoice date, which is only editable while the invoice is a draft.
  const { data: current } = await supabase
    .from('invoices')
    .select('status')
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .single()
  const previousStatus = (current as { status: string } | null)?.status ?? null

  const allowedFields: InvoiceUpdate = {}
  if ('status' in updates) allowedFields.status = updates.status
  if ('issued_date' in updates) {
    if (previousStatus && previousStatus !== 'draft') {
      return NextResponse.json({ error: 'Invoice date is locked once the invoice has been sent' }, { status: 400 })
    }
    allowedFields.issued_date = updates.issued_date
  }
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

  const syncConditionMet = updates.status === 'sent' && previousStatus !== 'sent'
  console.log(
    `[invoice-patch] sync-condition check — newStatus=${updates.status ?? 'not set'} previousStatus=${previousStatus ?? 'null'} conditionMet=${syncConditionMet}`
  )

  // Auto-trigger accounting sync when an invoice is first marked sent.
  // Must be awaited — Vercel terminates the execution context when the response is sent,
  // so a fire-and-forget void call is killed before it can write 'failed' to the DB.
  if (syncConditionMet) {
    console.log(
      `[invoice-sync] Auto-triggering sync for invoice ${invoiceId} on status change to 'sent'`
    )
    try {
      await syncInvoiceToAccounting(supabase, tenantId, invoiceId)
    } catch (err: unknown) {
      // syncInvoiceToAccounting catches its own errors and writes 'failed' to the DB.
      // This outer catch is a last-resort guard and should never be reached.
      console.error(`[invoice-sync] Unexpected sync error for invoice ${invoiceId}:`, err)
    }
  }

  return NextResponse.json({ invoice })
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
