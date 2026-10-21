import { randomUUID } from 'node:crypto'
import type { Json } from '@/lib/supabase/database.types'
import { createServiceClient } from '@/lib/supabase/server'
import { QuoteDocumentError } from '@/lib/documents/quote-document-data'
import { DEFAULT_EXPIRY_DAYS, signingLinkFor } from '@/lib/signing/config'
import { getSigningDocumentType } from '@/lib/signing/documents/registry'
import { isValidEmail } from '@/lib/signing/email/gmail'
import { sendSigningRequestEmail, SigningEmailError } from '@/lib/signing/email/messages'
import { logSigningEvent } from '@/lib/signing/events'
import { FieldLocationError, locateSignatureFields } from '@/lib/signing/pdf/locate-fields'
import {
  SigningError,
  type CreateSigningRequestInput,
  type SendSigningRequestOptions,
  type SignedDocument,
  type SigningActor,
  type SigningProvider,
} from '@/lib/signing/provider'
import { loadJobAndTenant, loadRequestForTenant, persistExpiryIfDue } from '@/lib/signing/repository'
import { downloadSigningPdf, removeSigningPdf, sourcePdfPath, uploadSigningPdf } from '@/lib/signing/storage'
import { generateSigningToken, hashSigningToken, sha256Hex } from '@/lib/signing/tokens'
import { effectiveStatus, toSigningRequestSummary, type SigningRequestSummary } from '@/lib/signing/types'
import { signedFilename } from '@/lib/signing/completion'

// In-house signing: IRC Master generates the PDF, emails a single-use link,
// shows the document on its own /sign/[token] page and stamps the signature
// itself (signer side: ./signer.ts). No external service.

const MAX_NAME = 120

function cleanSigner(input: CreateSigningRequestInput['signer']) {
  const name = input.name?.trim().replace(/\s+/g, ' ') ?? ''
  const email = input.email?.trim() ?? ''
  const phone = input.phone?.trim() || null
  if (!name) throw new SigningError('Enter the signer’s name', 400)
  if (name.length > MAX_NAME) throw new SigningError('The signer’s name is too long', 400)
  if (!isValidEmail(email)) throw new SigningError('Enter a valid email address for the signer', 400)
  if (phone && !/^[+\d][\d\s()-]{5,20}$/.test(phone)) throw new SigningError('The phone number doesn’t look right', 400)
  return { name, email, phone }
}

export class InHouseSigningProvider implements SigningProvider {
  readonly id = 'in_house'

  async createRequest(actor: SigningActor, input: CreateSigningRequestInput): Promise<SigningRequestSummary> {
    const docType = getSigningDocumentType(input.documentType)
    if (!docType) throw new SigningError('Unknown document type', 400)
    const signer = cleanSigner(input.signer)
    const service = createServiceClient()

    let generated
    let located
    try {
      generated = await docType.generate({ supabase: service, tenantId: actor.tenantId }, { jobId: input.jobId, quoteIds: input.quoteIds })
      located = await locateSignatureFields(new Uint8Array(generated.pdf), docType.fields)
    } catch (err) {
      if (err instanceof QuoteDocumentError) throw new SigningError(err.message, err.status === 500 ? 500 : err.status)
      if (err instanceof FieldLocationError) {
        console.error('[signing] field location failed:', err)
        throw new SigningError('The document was generated but its signature boxes could not be found. Please report this.', 500)
      }
      throw err
    }

    const requestId = randomUUID()
    const path = sourcePdfPath(actor.tenantId, requestId)
    const sourceSha256 = sha256Hex(located.pdf)
    await uploadSigningPdf(service, path, located.pdf)

    const { data: row, error } = await service
      .from('signing_requests')
      .insert({
        id: requestId,
        tenant_id: actor.tenantId,
        job_id: input.jobId,
        document_type: docType.key,
        document_title: generated.title,
        quote_ids: [...new Set(input.quoteIds)],
        provider: this.id,
        status: 'draft',
        signer_name: signer.name,
        signer_email: signer.email,
        signer_phone: signer.phone,
        source_pdf_path: path,
        source_pdf_sha256: sourceSha256,
        fields: located.fields as unknown as Json,
        display_content: generated.display as unknown as Json,
        reminders_enabled: input.remindersEnabled !== false,
        created_by: actor.userId,
      })
      .select('*')
      .single()
    if (error || !row) {
      await removeSigningPdf(service, path)
      throw new SigningError(`Could not save the signing request: ${error?.message ?? 'unknown error'}`, 500)
    }

    await logSigningEvent(service, {
      requestId,
      tenantId: actor.tenantId,
      event: 'created',
      actorId: actor.userId,
      metadata: {
        documentType: docType.key,
        quoteIds: row.quote_ids,
        totalInclGst: Math.round(generated.totalInclGst * 100) / 100,
        sourceSha256,
        fields: located.fields.map(f => ({ id: f.id, page: f.signature.page + 1 })),
      },
    })
    return toSigningRequestSummary(row)
  }

  async send(actor: SigningActor, requestId: string, options: SendSigningRequestOptions = {}): Promise<SigningRequestSummary> {
    const service = createServiceClient()
    const row = await persistExpiryIfDue(service, await loadRequestForTenant(service, actor.tenantId, requestId))
    const status = effectiveStatus(row)
    const fresh = options.resend || options.reminder

    if (status === 'signed') throw new SigningError('This document has already been signed', 409)
    if (status === 'revoked') throw new SigningError('This request was cancelled. Create a new one to send it again.', 409)
    if (!fresh && status !== 'draft') throw new SigningError('This request has already been sent. Use Resend.', 409)
    if (fresh && status === 'draft') throw new SigningError('This request hasn’t been sent yet', 409)
    if (!row.signer_email) throw new SigningError('The signer has no email address', 422)

    const { job, tenant } = await loadJobAndTenant(service, actor.tenantId, row.job_id)

    // New link: the previous token (if any) stops working as soon as this is saved.
    const token = generateSigningToken()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + DEFAULT_EXPIRY_DAYS * 86400_000).toISOString()
    const nextStatus = row.viewed_at ? 'viewed' : 'sent'
    const previous = { token_hash: row.token_hash, expires_at: row.expires_at, status: row.status, sent_at: row.sent_at }

    const { data: updated, error } = await service
      .from('signing_requests')
      .update({
        token_hash: hashSigningToken(token),
        expires_at: expiresAt,
        status: nextStatus,
        sent_at: now.toISOString(),
        ...(options.reminder ? { last_reminded_at: now.toISOString(), reminder_count: row.reminder_count + 1 } : {}),
      })
      .eq('id', row.id)
      .eq('tenant_id', actor.tenantId)
      .eq('status', row.status)
      .select('*')
      .maybeSingle()
    if (error) throw new SigningError(`Could not issue a signing link: ${error.message}`, 500)
    if (!updated) throw new SigningError('This request changed while sending. Refresh and try again.', 409)

    try {
      const sent = await sendSigningRequestEmail(service, {
        request: updated,
        job,
        tenant,
        signingLink: signingLinkFor(token),
        kind: options.reminder ? 'reminder' : options.resend ? 'resend' : 'initial',
        actorId: actor.userId,
        excessInvoice: options.accompanying?.excessInvoice,
      })
      await logSigningEvent(service, {
        requestId: row.id,
        tenantId: actor.tenantId,
        event: options.reminder ? 'reminded' : options.resend ? 'resent' : 'sent',
        actorId: actor.userId,
        metadata: {
          channel: 'email',
          to: updated.signer_email,
          expiresAt,
          gmailId: sent.gmailId,
          ...(options.accompanying?.excessInvoice ? { excessInvoiceRef: options.accompanying.excessInvoice.ref } : {}),
        },
      })
      return toSigningRequestSummary(updated)
    } catch (err) {
      // Put the request back as it was, so the previous link (if any) keeps working.
      await service
        .from('signing_requests')
        .update({
          ...previous,
          ...(options.reminder ? { last_reminded_at: row.last_reminded_at, reminder_count: row.reminder_count } : {}),
        })
        .eq('id', row.id)
      await logSigningEvent(service, {
        requestId: row.id,
        tenantId: actor.tenantId,
        event: 'send_failed',
        actorId: actor.userId,
        metadata: { channel: 'email', error: err instanceof Error ? err.message : String(err) },
      })
      console.error(`[signing] sending request ${row.id} failed:`, err)
      if (err instanceof SigningEmailError) throw new SigningError(err.message, 422)
      throw new SigningError('The email could not be sent. Nothing was changed — please try again.', 502)
    }
  }

  async getStatus(actor: SigningActor, requestId: string): Promise<SigningRequestSummary> {
    const service = createServiceClient()
    const row = await persistExpiryIfDue(service, await loadRequestForTenant(service, actor.tenantId, requestId))
    return toSigningRequestSummary(row)
  }

  async getSignedDocument(actor: SigningActor, requestId: string): Promise<SignedDocument | null> {
    const service = createServiceClient()
    const row = await loadRequestForTenant(service, actor.tenantId, requestId)
    if (row.status !== 'signed' || !row.signed_pdf_path) return null
    const { job } = await loadJobAndTenant(service, actor.tenantId, row.job_id)
    const pdf = await downloadSigningPdf(service, row.signed_pdf_path)
    return { pdf, filename: signedFilename(row, job), sha256: row.signed_pdf_sha256 }
  }

  async revoke(actor: SigningActor, requestId: string, reason?: string | null): Promise<SigningRequestSummary> {
    const service = createServiceClient()
    const row = await loadRequestForTenant(service, actor.tenantId, requestId)
    if (row.status === 'signed') throw new SigningError('A signed document can’t be revoked', 409)
    if (row.status === 'revoked') return toSigningRequestSummary(row)

    const { data, error } = await service
      .from('signing_requests')
      .update({
        status: 'revoked',
        revoked_at: new Date().toISOString(),
        revoked_reason: reason?.trim().slice(0, 500) || null,
      })
      .eq('id', row.id)
      .eq('tenant_id', actor.tenantId)
      .neq('status', 'signed')
      .select('*')
      .maybeSingle()
    if (error) throw new SigningError(`Could not revoke: ${error.message}`, 500)
    if (!data) throw new SigningError('This document was signed before it could be revoked', 409)

    await logSigningEvent(service, {
      requestId: row.id,
      tenantId: actor.tenantId,
      event: 'revoked',
      actorId: actor.userId,
      metadata: { reason: data.revoked_reason },
    })
    return toSigningRequestSummary(data)
  }
}
