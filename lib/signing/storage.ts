import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { SIGNED_DOCUMENTS_BUCKET } from './config'

// Path conventions in the private 'signed-documents' bucket:
//   tenants/{tenantId}/signing/{requestId}/source.pdf   what the signer is shown and signs
//   tenants/{tenantId}/signing/{requestId}/signed.pdf   stamped + Signature Certificate
//   tenants/{tenantId}/signing/{requestId}/excess-invoice.pdf  excess invoice as emailed (if any)
//   tenants/{tenantId}/signing/{requestId}/pages/page-{n}.png  source pages as images (signer page)
// Only the service role can read or write this bucket.

type Service = SupabaseClient<Database>

export function sourcePdfPath(tenantId: string, requestId: string): string {
  return `tenants/${tenantId}/signing/${requestId}/source.pdf`
}

export function signedPdfPath(tenantId: string, requestId: string): string {
  return `tenants/${tenantId}/signing/${requestId}/signed.pdf`
}

/** Copy of the excess invoice exactly as emailed with the request (signer page download). */
export function excessInvoicePdfPath(tenantId: string, requestId: string): string {
  return `tenants/${tenantId}/signing/${requestId}/excess-invoice.pdf`
}

/** Image of page n (1-based) of the source PDF, shown on the signer page. */
export function pageImagePath(tenantId: string, requestId: string, pageNumber: number): string {
  return `tenants/${tenantId}/signing/${requestId}/pages/page-${pageNumber}.png`
}

export async function uploadSigningFile(service: Service, path: string, data: Uint8Array, contentType: string): Promise<void> {
  const { error } = await service.storage
    .from(SIGNED_DOCUMENTS_BUCKET)
    .upload(path, data, { contentType, upsert: false })
  if (error) throw new Error(`Upload to ${SIGNED_DOCUMENTS_BUCKET}/${path} failed: ${error.message}`)
}

export async function uploadSigningPdf(service: Service, path: string, pdf: Uint8Array): Promise<void> {
  const { error } = await service.storage
    .from(SIGNED_DOCUMENTS_BUCKET)
    .upload(path, pdf, { contentType: 'application/pdf', upsert: false })
  if (error) throw new Error(`Upload to ${SIGNED_DOCUMENTS_BUCKET}/${path} failed: ${error.message}`)
}

export async function downloadSigningFile(service: Service, path: string): Promise<Buffer> {
  const { data, error } = await service.storage.from(SIGNED_DOCUMENTS_BUCKET).download(path)
  if (error || !data) throw new Error(`Download of ${SIGNED_DOCUMENTS_BUCKET}/${path} failed: ${error?.message ?? 'no data'}`)
  return Buffer.from(await data.arrayBuffer())
}

export const downloadSigningPdf = downloadSigningFile

export async function removeSigningPdf(service: Service, path: string | string[]): Promise<void> {
  const paths = Array.isArray(path) ? path : [path]
  if (paths.length === 0) return
  const { error } = await service.storage.from(SIGNED_DOCUMENTS_BUCKET).remove(paths)
  if (error) console.error(`[signing] cleanup of ${paths.join(', ')} failed:`, error)
}
