import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { SIGNED_DOCUMENTS_BUCKET } from './config'

// Path conventions in the private 'signed-documents' bucket:
//   tenants/{tenantId}/signing/{requestId}/source.pdf   what the signer is shown and signs
//   tenants/{tenantId}/signing/{requestId}/signed.pdf   stamped + Signature Certificate
//   tenants/{tenantId}/signing/{requestId}/excess-invoice.pdf  excess invoice as emailed (if any)
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

export async function uploadSigningPdf(service: Service, path: string, pdf: Uint8Array): Promise<void> {
  const { error } = await service.storage
    .from(SIGNED_DOCUMENTS_BUCKET)
    .upload(path, pdf, { contentType: 'application/pdf', upsert: false })
  if (error) throw new Error(`Upload to ${SIGNED_DOCUMENTS_BUCKET}/${path} failed: ${error.message}`)
}

export async function downloadSigningPdf(service: Service, path: string): Promise<Buffer> {
  const { data, error } = await service.storage.from(SIGNED_DOCUMENTS_BUCKET).download(path)
  if (error || !data) throw new Error(`Download of ${SIGNED_DOCUMENTS_BUCKET}/${path} failed: ${error?.message ?? 'no data'}`)
  return Buffer.from(await data.arrayBuffer())
}

export async function removeSigningPdf(service: Service, path: string): Promise<void> {
  const { error } = await service.storage.from(SIGNED_DOCUMENTS_BUCKET).remove([path])
  if (error) console.error(`[signing] cleanup of ${path} failed:`, error)
}
