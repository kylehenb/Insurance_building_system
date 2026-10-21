import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { filenamePart } from '@/lib/documents/document-assets'
import { signingDocumentLabel } from './documents/catalog'
import { sendSignedCopyEmails } from './email/messages'
import { logSigningEvent } from './events'
import { formatPerthDateTime, formatSigningDate } from './format'
import { recordJobSignoffSigned } from './job-sync'
import { loadJobAndTenant } from './repository'
import type { SigningRequestRow } from './types'

// What happens once a signed PDF is safely stored, whichever provider
// collected the signature:
//   1. a copy goes into the job's Files (job-files bucket + job_files row)
//   2. a system note is added to the job's communications
//   3. the job's homeowner sign-off method/notes are recorded (stage untouched)
//   4. the signer and the office are emailed the signed copy
// Each step is independent: one failing doesn't stop the others, and none
// of them can undo the signature.

type Service = SupabaseClient<Database>

export function signedFilename(request: SigningRequestRow, job: { job_number: string; property_address: string | null }): string {
  const parts = [
    `Signed ${signingDocumentLabel(request.document_type)}`,
    filenamePart(job.job_number),
    filenamePart(job.property_address).slice(0, 70),
    request.signed_at ? formatSigningDate(request.signed_at).replace(/\s/g, '-') : '',
  ].filter(Boolean)
  return `${parts.join(' - ')}.pdf`
}

async function saveToJobFiles(service: Service, request: SigningRequestRow, pdf: Uint8Array, filename: string) {
  const storagePath = `tenants/${request.tenant_id}/jobs/${request.job_id}/docs/${Date.now()}-${filename.replace(/[^\w.,\- ]/g, '_')}`
  const { error: uploadErr } = await service.storage
    .from('job-files')
    .upload(storagePath, pdf, { contentType: 'application/pdf' })
  if (uploadErr) throw new Error(`job-files upload failed: ${uploadErr.message}`)

  const { data, error } = await service
    .from('job_files')
    .insert({
      tenant_id: request.tenant_id,
      job_id: request.job_id,
      description: `Insured signed docs — ${signingDocumentLabel(request.document_type)} (signed electronically)`,
      file_name: filename,
      file_kind: 'PDF',
      storage_path: storagePath,
      mime_type: 'application/pdf',
      size_bytes: pdf.length,
      added_by: request.created_by,
      is_system_generated: true,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`job_files insert failed: ${error?.message ?? 'no row'}`)

  await service.from('signing_requests').update({ signed_job_file_id: data.id }).eq('id', request.id)
  return { jobFileId: data.id, storagePath }
}

export async function recordSignedDocument(service: Service, request: SigningRequestRow, signedPdf: Uint8Array): Promise<void> {
  const { job, tenant } = await loadJobAndTenant(service, request.tenant_id, request.job_id)
  const filename = signedFilename(request, job)
  const documentName = signingDocumentLabel(request.document_type)

  let jobFileStoragePath: string | null = null
  try {
    jobFileStoragePath = (await saveToJobFiles(service, request, signedPdf, filename)).storagePath
  } catch (err) {
    console.error(`[signing] saving signed copy to job files failed for ${request.id}:`, err)
  }

  const { error: noteErr } = await service.from('communications').insert({
    tenant_id: request.tenant_id,
    job_id: request.job_id,
    type: 'portal',
    direction: 'inbound',
    contact_type: 'insured',
    contact_name: request.signer_name,
    content: `${documentName} signed electronically by ${request.signer_name}${request.signed_at ? ` on ${formatPerthDateTime(request.signed_at)}` : ''}. Signed copy saved to Files.`,
    source: 'signing',
    attachments: jobFileStoragePath
      ? [{ filename, storage_path: jobFileStoragePath, mime_type: 'application/pdf', size_bytes: signedPdf.length }]
      : [],
  })
  if (noteErr) console.error(`[signing] communications note failed for ${request.id}:`, noteErr)

  await recordJobSignoffSigned(service, request)

  const result = await sendSignedCopyEmails(service, {
    request,
    job,
    tenant,
    signedPdf,
    filename,
    jobFileStoragePath,
    signedPdfSha256: request.signed_pdf_sha256 ?? '',
  })
  await logSigningEvent(service, {
    requestId: request.id,
    tenantId: request.tenant_id,
    event: 'signed_copy_sent',
    metadata: { toSigner: result.signerSent, toOffice: result.officeSent, failed: result.errors },
  })
}
