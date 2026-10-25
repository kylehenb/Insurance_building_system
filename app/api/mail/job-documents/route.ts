import { NextRequest, NextResponse } from 'next/server'
import { composeAccess } from '@/lib/mail/access'
import { ComposeError } from '@/lib/mail/compose'
import { renderJobDocument } from '@/lib/mail/job-documents'
import { storeDraftUpload } from '@/lib/mail/job-files'
import { DocumentSendError, parseDocumentRef } from '@/lib/documents/send/documents'
import { PrintDataError } from '@/lib/documents/print-data'

export const maxDuration = 120

// POST /api/mail/job-documents { jobId, ref } — a job's quote, report or
// invoice as a PDF attachment for the email being written. Rendered once
// here (the same PDF the job's Send attaches) and kept with the draft's other
// uploads. Attaching doesn't mark the document as sent — the job's Send does.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const access = await composeAccess()
  if (access instanceof NextResponse) return access

  let body: { jobId?: unknown; ref?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  try {
    const ref = parseDocumentRef(body.ref)
    const doc = await renderJobDocument(access.tenantId, typeof body.jobId === 'string' ? body.jobId : null, ref)
    const attachment = await storeDraftUpload(access.tenantId, doc)
    return NextResponse.json({ attachment, title: doc.title, warnings: doc.warnings })
  } catch (err) {
    if (err instanceof DocumentSendError || err instanceof PrintDataError) {
      return NextResponse.json({ error: err.message }, { status: (err as { status?: number }).status ?? 400 })
    }
    if (err instanceof ComposeError && err.status !== 502) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[mail] job document attach failed:', err)
    return NextResponse.json({ error: 'Could not make the PDF' }, { status: 502 })
  }
}
