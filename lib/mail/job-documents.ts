import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { DocumentSendError, prepareDocument, type DocumentRef } from '@/lib/documents/send/documents'
import { ComposeError } from './compose'
import type { JobFileContent } from './job-files'
import { mailDb } from './sync'

// A job's quote, report or invoice as a PDF attachment for an email being
// written — the same PDF the job's Send attaches. Attaching doesn't mark the
// document as sent; the job's Send does. Used by the composer's Attach
// document (app/api/mail/job-documents) and the voice connector.

export interface JobDocumentPdf extends JobFileContent {
  title: string
  warnings: string[]
}

/** Renders the document; jobId (when given) must be the job it belongs to. */
export async function renderJobDocument(tenantId: string, jobId: string | null, ref: DocumentRef, db = mailDb()): Promise<JobDocumentPdf> {
  const doc = await prepareDocument(ref, { supabase: db as unknown as SupabaseClient<Database>, tenantId })
  if (jobId && doc.job.id !== jobId) throw new DocumentSendError('That document belongs to another job', 400)
  let content: Buffer
  try {
    content = await doc.render()
  } catch (err) {
    console.error(`[mail] PDF failed for ${ref.kind} ${ref.id}:`, err)
    throw new ComposeError(`Couldn't make the PDF for ${doc.title}`, 502)
  }
  return { filename: doc.filename, mimeType: 'application/pdf', content, title: doc.title, warnings: doc.warnings ?? [] }
}
