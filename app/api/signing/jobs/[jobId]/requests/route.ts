import { NextRequest, NextResponse } from 'next/server'
import { isUuid, signingActorFromSession, signingErrorResponse, unauthorized } from '@/lib/signing/http'
import { getSendDialogDefaults, listSigningRequestsForJob, sendForSignature } from '@/lib/signing/service'
import { SIGNING_DOCUMENT_TYPES } from '@/lib/signing/documents/registry'
import type { SigningDocumentTypeKey } from '@/lib/signing/types'
import { parseExcessChoice } from '@/lib/excess/decision'
import { permissionDenied } from '@/lib/permissions/http'

// GET  → this job's signing requests, plus defaults for the send dialog
// POST → generate the document, create the request and email the signer
//        { documentType, quoteIds, signer: { name, email, phone? }, moveJobToAwaitingStage?, remindersEnabled?,
//          excess?: ExcessChoice (required for insurance jobs; see lib/excess/decision.ts) }
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  if (!isUuid(jobId)) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  const actor = await signingActorFromSession()
  if (!actor) return unauthorized()

  try {
    const [requests, defaults] = await Promise.all([
      listSigningRequestsForJob(actor, jobId),
      getSendDialogDefaults(actor, jobId),
    ])
    return NextResponse.json({ requests, defaults })
  } catch (err) {
    return signingErrorResponse(err, 'load signing requests')
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  if (!isUuid(jobId)) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  const actor = await signingActorFromSession()
  if (!actor) return unauthorized()
  const denied = await permissionDenied(actor.tenantId, actor.userId, 'send.signing')
  if (denied) return denied

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const documentType = body.documentType
  if (typeof documentType !== 'string' || !(documentType in SIGNING_DOCUMENT_TYPES)) {
    return NextResponse.json({ error: 'Choose a document type' }, { status: 400 })
  }
  const quoteIds = Array.isArray(body.quoteIds) ? body.quoteIds.filter((id): id is string => isUuid(id as string)) : []
  if (quoteIds.length === 0) return NextResponse.json({ error: 'Choose at least one approved quote' }, { status: 400 })
  const signer = (body.signer ?? {}) as Record<string, unknown>
  const excess = body.excess == null ? null : parseExcessChoice(body.excess)
  if (body.excess != null && !excess) return NextResponse.json({ error: 'The excess choice is not valid' }, { status: 400 })
  const str = (v: unknown) => (typeof v === 'string' ? v : '')

  try {
    const result = await sendForSignature(
      actor,
      {
        jobId,
        documentType: documentType as SigningDocumentTypeKey,
        quoteIds,
        signer: { name: str(signer.name), email: str(signer.email), phone: str(signer.phone) || null },
        remindersEnabled: body.remindersEnabled !== false,
      },
      { moveJobToAwaitingStage: body.moveJobToAwaitingStage === true, excess },
    )
    return NextResponse.json(result)
  } catch (err) {
    return signingErrorResponse(err, 'send for signature')
  }
}
