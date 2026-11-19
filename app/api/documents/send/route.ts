import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'
import { createServiceClient } from '@/lib/supabase/server'
import { DocumentSendError, parseDocumentRef } from '@/lib/documents/send/documents'
import {
  buildDocumentEmailDraft,
  markDocumentsSentWithoutEmail,
  sendDocumentEmail,
  type DocumentEmailContext,
  type DocumentEmailOverrides,
} from '@/lib/documents/send/email'
import { permissionGate } from '@/lib/permissions/http'
import { recordOperation } from '@/lib/activity/log'
import { ExtraFileError, parseExtraFiles } from '@/lib/email/extra-files'
import { parseSendWithoutInvoice, ReportWithoutInvoiceError } from '@/lib/documents/send/invoice-check'

// Email quotes, reports, invoices, TCCs and photos from a job.
// POST { documents: DocumentRef[], mode }
//   mode 'draft'     → the pre-filled email for the send dialog (nothing sent)
//   mode 'auto'      → send the template as-is
//   mode 'custom'    → send with { to, cc, subject, body } as edited, plus
//                      files: the job's files/photos or uploads (lib/email/extra-files)
//   mode 'mark_sent' → no email; mark the documents sent (sent another way)
// Any mode may add replyToOrder: true (reply in the job's insurer order email
// thread) and inspectionId (the inspection package: mark it Sent and Locked).
// A report without its invoice stops with 409 { code: 'report_without_invoice',
// missing } unless sendWithoutInvoice: { reason } is given (its own permission).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function context(): Promise<DocumentEmailContext | null> {
  const user = await getUser()
  if (!user?.tenant_id) return null
  // Service client: the permission is checked here, and every query filters tenant_id.
  // (The user's own session could be stopped part way by database rules.)
  return { supabase: createServiceClient(), tenantId: user.tenant_id, actorId: user.session?.user.id ?? null }
}

export async function POST(req: NextRequest) {
  const ctx = await context()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let parsed: Record<string, unknown>
  try {
    parsed = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const mode = parsed.mode
  try {
    if (!Array.isArray(parsed.documents)) throw new DocumentSendError('documents is required', 400)
    const refs = parsed.documents.map(parseDocumentRef)

    const str = (k: string) => (typeof parsed[k] === 'string' ? parsed[k] as string : undefined)
    const replyToOrder = parsed.replyToOrder === true
    const inspectionId = str('inspectionId')
    if (inspectionId !== undefined && !UUID_RE.test(inspectionId)) throw new DocumentSendError('inspectionId is not valid', 400)

    if (mode === 'draft') return NextResponse.json(await buildDocumentEmailDraft(refs, ctx, { replyToOrder }))
    const sendWithoutInvoice = parseSendWithoutInvoice(parsed.sendWithoutInvoice)
    let overrides: DocumentEmailOverrides = {
      ...(replyToOrder ? { replyToOrder } : {}),
      ...(inspectionId ? { inspectionId } : {}),
      ...(sendWithoutInvoice ? { sendWithoutInvoice } : {}),
    }
    if (mode === 'custom') {
      const files = parseExtraFiles(parsed.files, ctx.tenantId)
      overrides = { ...overrides, to: str('to') ?? '', cc: str('cc') ?? '', subject: str('subject'), body: str('body'), ...(files.length ? { files } : {}) }
    } else if (mode !== 'auto' && mode !== 'mark_sent') {
      return NextResponse.json({ error: "mode must be 'draft', 'auto', 'custom' or 'mark_sent'" }, { status: 400 })
    }

    // Sending, or marking as sent, needs the send permission (or approval)
    const gated = await permissionGate(ctx.tenantId, ctx.actorId, 'send.documents', {
      operation: 'documents.send', payload: { refs, mode, overrides },
    })
    if (gated) return gated
    // Sending a report without its invoice is its own permission (or approval)
    if (sendWithoutInvoice) {
      const gatedWithout = await permissionGate(ctx.tenantId, ctx.actorId, 'send.report_without_invoice', {
        operation: 'documents.send', payload: { refs, mode, overrides },
      })
      if (gatedWithout) return gatedWithout
    }

    const result = mode === 'mark_sent' ? await markDocumentsSentWithoutEmail(refs, ctx, overrides) : await sendDocumentEmail(refs, ctx, overrides)
    await recordOperation({ tenantId: ctx.tenantId, userId: ctx.actorId, action: 'send.documents', operation: 'documents.send', payload: { refs, mode, overrides } })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof ExtraFileError) return NextResponse.json({ error: err.message }, { status: err.status })
    if (err instanceof ReportWithoutInvoiceError) return NextResponse.json({ error: err.message, code: err.code, missing: err.missing }, { status: err.status })
    if (err instanceof DocumentSendError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error(`[documents/send] ${String(mode)} failed:`, err)
    return NextResponse.json({ error: mode === 'draft' ? 'Failed to prepare the email' : 'Failed to send' }, { status: 500 })
  }
}
