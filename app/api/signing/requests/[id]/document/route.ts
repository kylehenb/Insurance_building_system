import { NextRequest, NextResponse } from 'next/server'
import { isUuid, pdfResponse, signingActorFromSession, signingErrorResponse, unauthorized } from '@/lib/signing/http'
import { getSigningProvider, getSourceDocument } from '@/lib/signing/service'

// GET ?version=signed (default) → the signed PDF with its certificate
// GET ?version=source           → the unsigned document as sent
// Streams from the private bucket after checking the user's tenant.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Signing request not found' }, { status: 404 })
  const actor = await signingActorFromSession()
  if (!actor) return unauthorized()
  const download = req.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline'

  try {
    if (req.nextUrl.searchParams.get('version') === 'source') {
      const doc = await getSourceDocument(actor, id)
      return pdfResponse(doc.pdf, doc.filename, download)
    }
    const doc = await getSigningProvider().getSignedDocument(actor, id)
    if (!doc) return NextResponse.json({ error: 'This document hasn’t been signed yet' }, { status: 404 })
    return pdfResponse(doc.pdf, doc.filename, download)
  } catch (err) {
    return signingErrorResponse(err, 'open document')
  }
}
