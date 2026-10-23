import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'
import { createClient } from '@/lib/supabase/server'
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

// Email quotes, reports, invoices, TCCs and photos from a job.
// POST { documents: DocumentRef[], mode }
//   mode 'draft'     → the pre-filled email for the send dialog (nothing sent)
//   mode 'auto'      → send the template as-is
//   mode 'custom'    → send with { to, cc, subject, body } as edited
//   mode 'mark_sent' → no email; mark the documents sent (sent another way)
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function context(): Promise<DocumentEmailContext | null> {
  const user = await getUser()
  if (!user?.tenant_id) return null
  return { supabase: await createClient(), tenantId: user.tenant_id, actorId: user.session?.user.id ?? null }
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

    if (mode === 'draft') return NextResponse.json(await buildDocumentEmailDraft(refs, ctx))
    let overrides: DocumentEmailOverrides = {}
    if (mode === 'custom') {
      const str = (k: string) => (typeof parsed[k] === 'string' ? parsed[k] as string : undefined)
      overrides = { to: str('to') ?? '', cc: str('cc') ?? '', subject: str('subject'), body: str('body') }
    } else if (mode !== 'auto' && mode !== 'mark_sent') {
      return NextResponse.json({ error: "mode must be 'draft', 'auto', 'custom' or 'mark_sent'" }, { status: 400 })
    }

    // Sending, or marking as sent, needs the send permission (or approval)
    const gated = await permissionGate(ctx.tenantId, ctx.actorId, 'send.documents', {
      operation: 'documents.send', payload: { refs, mode, overrides },
    })
    if (gated) return gated

    const result = mode === 'mark_sent' ? await markDocumentsSentWithoutEmail(refs, ctx) : await sendDocumentEmail(refs, ctx, overrides)
    await recordOperation({ tenantId: ctx.tenantId, userId: ctx.actorId, action: 'send.documents', operation: 'documents.send', payload: { refs, mode, overrides } })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof DocumentSendError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error(`[documents/send] ${String(mode)} failed:`, err)
    return NextResponse.json({ error: mode === 'draft' ? 'Failed to prepare the email' : 'Failed to send' }, { status: 500 })
  }
}
