import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { composeAccess } from '@/lib/mail/access'
import { ATTACHMENT_BUCKET } from '@/lib/mail/compose'
import type { DraftAttachment } from '@/lib/mail/compose-rules'
import { mailDb } from '@/lib/mail/sync'
import { DocumentSendError, parseDocumentRef, prepareDocument } from '@/lib/documents/send/documents'
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
    const db = mailDb()
    const doc = await prepareDocument(ref, { supabase: db as unknown as SupabaseClient<Database>, tenantId: access.tenantId })
    if (typeof body.jobId === 'string' && doc.job.id !== body.jobId) {
      return NextResponse.json({ error: 'That document belongs to another job' }, { status: 400 })
    }
    const pdf = await doc.render()
    const path = `${access.tenantId}/${randomUUID()}/${doc.filename.replace(/[/\\]/g, '_')}`
    const { error } = await db.storage.from(ATTACHMENT_BUCKET).upload(path, pdf, { contentType: 'application/pdf' })
    if (error) throw new Error(error.message)
    const attachment: DraftAttachment = { kind: 'upload', path, filename: doc.filename, mimeType: 'application/pdf', size: pdf.length }
    return NextResponse.json({ attachment, title: doc.title, warnings: doc.warnings ?? [] })
  } catch (err) {
    if (err instanceof DocumentSendError || err instanceof PrintDataError) {
      return NextResponse.json({ error: err.message }, { status: (err as { status?: number }).status ?? 400 })
    }
    console.error('[mail] job document attach failed:', err)
    return NextResponse.json({ error: 'Could not make the PDF' }, { status: 502 })
  }
}
