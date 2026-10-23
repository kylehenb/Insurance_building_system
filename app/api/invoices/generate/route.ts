import { NextRequest, NextResponse } from 'next/server'
import { permissionGate } from '@/lib/permissions/http'
import { recordOperation } from '@/lib/activity/log'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'
import { InvoiceGenerateError, generateInvoice, type GenerateInvoiceInput } from '@/lib/invoices/generate'

// The invoice buttons: creates a draft invoice of the chosen type for a job
// (lib/invoices/generate.ts).
export async function POST(req: NextRequest) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const body = await req.json().catch(() => ({})) as Partial<GenerateInvoiceInput>
  const input: GenerateInvoiceInput = {
    type: body.type ?? '', jobId: body.jobId ?? '', reportId: body.reportId, excessAmountIncGst: body.excessAmountIncGst,
  }
  if (!input.type || !input.jobId) return NextResponse.json({ error: 'Missing required fields: type, jobId' }, { status: 400 })

  // "Needs approval" saves it for an approver, who creates it as this user
  const gated = await permissionGate(me.tenantId, me.userId, 'invoices.manage', { operation: 'invoice.generate', payload: { input } })
  if (gated) return gated

  try {
    const result = await generateInvoice(createServiceClient(), me.tenantId, input)
    await recordOperation({ tenantId: me.tenantId, userId: me.userId, action: 'invoices.manage', operation: 'invoice.generate', payload: { input }, detail: `Created ${result.invoice.invoice_ref ?? 'invoice'} for $${result.invoice.amount_inc_gst ?? 0}.` })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof InvoiceGenerateError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}
