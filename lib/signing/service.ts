import { createServiceClient } from '@/lib/supabase/server'
import type { JobContact } from '@/lib/types/contacts'
import { quotesTotalInclGst, SIGNABLE_QUOTE_STATUSES } from '@/lib/documents/quote-document-data'
import { suggestDocumentType } from './documents/catalog'
import { InHouseSigningProvider } from './in-house/provider'
import { confirmSignedStage, markJobSignoffSent } from './job-sync'
import { SigningError, type AccompanyingDocuments, type CreateSigningRequestInput, type SigningActor, type SigningProvider } from './provider'
import { loadRequestForTenant, persistExpiryIfDue } from './repository'
import { downloadSigningPdf, excessInvoicePdfPath, uploadSigningPdf } from './storage'
import { buildInvoicePdf, invoicePdfFilename } from '@/lib/documents/invoice-pdf'
import type { ExcessChoice, ExcessContext } from '@/lib/excess/decision'
import {
  abortExcessAfterFailedSend,
  ExcessError,
  excessDueText,
  finaliseExcessAfterSend,
  loadExcessContext,
  prepareExcessForSend,
  type PreparedExcess,
} from '@/lib/excess/server'
import { logSigningEvent } from './events'
import {
  toSigningEventSummary,
  toSigningRequestSummary,
  type SigningDocumentTypeKey,
  type SigningEventSummary,
  type SigningRequestSummary,
} from './types'

// Provider-neutral entry points for the API routes. The UI never talks to a
// provider directly.

let provider: SigningProvider | null = null

/** The configured signing provider. In-house is the only one today. */
export function getSigningProvider(): SigningProvider {
  provider ??= new InHouseSigningProvider()
  return provider
}

export async function listSigningRequestsForJob(actor: SigningActor, jobId: string): Promise<SigningRequestSummary[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('signing_requests')
    .select('*')
    .eq('tenant_id', actor.tenantId)
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
  if (error) throw new SigningError(`Could not load signing requests: ${error.message}`, 500)
  const rows = await Promise.all((data ?? []).map(row => persistExpiryIfDue(service, row)))
  const invoiceIds = [...new Set(rows.map(r => r.excess_invoice_id).filter((id): id is string => !!id))]
  const { data: invoices } = invoiceIds.length
    ? await service.from('invoices').select('*').in('id', invoiceIds).eq('tenant_id', actor.tenantId)
    : { data: [] }
  const byId = new Map((invoices ?? []).map(inv => [inv.id, inv]))
  return rows.map(row => {
    const summary = toSigningRequestSummary(row)
    const inv = row.excess_invoice_id ? byId.get(row.excess_invoice_id) : undefined
    return inv
      ? {
          ...summary,
          excessInvoice: {
            id: inv.id,
            ref: inv.invoice_ref,
            amountIncGst: Number(inv.amount_inc_gst ?? 0),
            status: inv.status,
            issuedDate: inv.issued_date,
            paidDate: inv.paid_date,
          },
        }
      : summary
  })
}

export async function listSigningEvents(actor: SigningActor, requestId: string): Promise<SigningEventSummary[]> {
  const service = createServiceClient()
  await loadRequestForTenant(service, actor.tenantId, requestId)
  const { data, error } = await service
    .from('signing_events')
    .select('*')
    .eq('tenant_id', actor.tenantId)
    .eq('request_id', requestId)
    .order('created_at', { ascending: true })
  if (error) throw new SigningError(`Could not load the audit trail: ${error.message}`, 500)
  return (data ?? []).map(toSigningEventSummary)
}

/** The unsigned document as generated, for the office to check. */
export async function getSourceDocument(actor: SigningActor, requestId: string): Promise<{ pdf: Buffer; filename: string }> {
  const service = createServiceClient()
  const row = await loadRequestForTenant(service, actor.tenantId, requestId)
  return { pdf: await downloadSigningPdf(service, row.source_pdf_path), filename: `${row.document_title} (unsigned).pdf` }
}

export interface SendForSignatureResult {
  request: SigningRequestSummary
  stageMoved: boolean
  /** Excess invoice sent with the document, if any */
  excessInvoiceRef: string | null
}

/**
 * Generate, (optionally) attach the excess invoice, and send — one email.
 *
 * Order matters so nothing is half-done:
 *   1. generate the document (draft request)
 *   2. prepare the excess: create a draft excess invoice if asked, render its PDF
 *   3. send the email
 *   4. only then: mark the invoice sent (→ accounting), record the excess
 *      decision on the job, link the invoice to the request
 * If 3 fails, the draft invoice is deleted and the draft request revoked.
 */
export async function sendForSignature(
  actor: SigningActor,
  input: CreateSigningRequestInput,
  options: { moveJobToAwaitingStage?: boolean; excess?: ExcessChoice | null } = {},
): Promise<SendForSignatureResult> {
  const service = createServiceClient()
  const excessCtx = await loadExcessContext(service, actor.tenantId, input.jobId)
  if (excessCtx.applies && !options.excess) {
    throw new SigningError('Choose what to do about the excess before sending.', 400)
  }
  const excessChoice = excessCtx.applies ? options.excess ?? null : null

  const p = getSigningProvider()
  const draft = await p.createRequest(actor, input)

  let prepared: PreparedExcess | null = null
  try {
    if (excessChoice) prepared = await prepareExcessForSend(service, { tenantId: actor.tenantId, jobId: input.jobId, choice: excessChoice })
  } catch (err) {
    await p.revoke(actor, draft.id, 'Not sent: the excess invoice could not be prepared').catch(() => undefined)
    if (err instanceof ExcessError) throw new SigningError(err.message, err.status)
    throw err
  }

  const { data: tenant } = await service.from('tenants').select('excess_payment_terms').eq('id', actor.tenantId).maybeSingle()
  const accompanying: AccompanyingDocuments | undefined = prepared?.invoice && prepared.attachment
    ? {
        excessInvoice: {
          ref: prepared.invoice.invoice_ref,
          amountIncGst: Number(prepared.invoice.amount_inc_gst ?? 0),
          dueText: excessDueText(prepared.invoice.issued_date, tenant?.excess_payment_terms),
          filename: prepared.attachment.filename,
          pdf: prepared.attachment.pdf,
        },
      }
    : undefined

  let sent: SigningRequestSummary
  try {
    sent = await p.send(actor, draft.id, { accompanying })
  } catch (err) {
    if (prepared) await abortExcessAfterFailedSend(service, actor.tenantId, prepared)
    await p.revoke(actor, draft.id, 'Not sent: the email failed').catch(() => undefined)
    if (err instanceof SigningError) {
      throw new SigningError(`${err.message} Nothing was sent${prepared?.createdDraft ? ' and no excess invoice was created' : ''} — please try again.`, err.status)
    }
    throw err
  }

  // The email has gone. Everything below is bookkeeping; failures are logged.
  if (prepared) {
    try {
      await finaliseExcessAfterSend(service, { tenantId: actor.tenantId, jobId: input.jobId, userId: actor.userId, prepared })
    } catch (err) {
      console.error(`[signing] excess bookkeeping failed for ${sent.id}:`, err)
    }
    if (prepared.invoice) {
      await service.from('signing_requests').update({ excess_invoice_id: prepared.invoice.id }).eq('id', sent.id).eq('tenant_id', actor.tenantId)
      if (prepared.attachment) {
        try {
          await uploadSigningPdf(service, excessInvoicePdfPath(actor.tenantId, sent.id), new Uint8Array(prepared.attachment.pdf))
        } catch (err) {
          console.error(`[signing] excess invoice copy upload failed for ${sent.id}:`, err)
        }
      }
    }
  }

  let stageMoved = false
  if (options.moveJobToAwaitingStage) {
    stageMoved = await markJobSignoffSent(service, await loadRequestForTenant(service, actor.tenantId, sent.id))
  }
  return { request: { ...sent, excessInvoiceId: prepared?.invoice?.id ?? null }, stageMoved, excessInvoiceRef: prepared?.invoice?.invoice_ref ?? null }
}

/**
 * Office "Resend": a fresh link, with the excess invoice attached again if one
 * went with the original. (Automatic reminders don't re-attach it.)
 */
export async function resendSigningRequest(actor: SigningActor, requestId: string): Promise<SigningRequestSummary> {
  const service = createServiceClient()
  const row = await loadRequestForTenant(service, actor.tenantId, requestId)
  let accompanying: AccompanyingDocuments | undefined
  if (row.excess_invoice_id) {
    const [{ data: invoice }, { data: tenant }] = await Promise.all([
      service.from('invoices').select('*').eq('id', row.excess_invoice_id).eq('tenant_id', actor.tenantId).maybeSingle(),
      service.from('tenants').select('excess_payment_terms').eq('id', actor.tenantId).maybeSingle(),
    ])
    if (invoice) {
      let pdf: Buffer
      let filename: string
      try {
        pdf = await downloadSigningPdf(service, excessInvoicePdfPath(actor.tenantId, row.id))
        const { data: job } = await service.from('jobs').select('property_address').eq('id', row.job_id).maybeSingle()
        filename = invoicePdfFilename(invoice, job?.property_address ?? null)
      } catch {
        ;({ pdf, filename } = await buildInvoicePdf(invoice.id, { supabase: service, tenantId: actor.tenantId }))
      }
      accompanying = {
        excessInvoice: {
          ref: invoice.invoice_ref,
          amountIncGst: Number(invoice.amount_inc_gst ?? 0),
          dueText: excessDueText(invoice.issued_date, tenant?.excess_payment_terms),
          filename,
          pdf,
        },
      }
    }
  }
  return getSigningProvider().send(actor, requestId, { resend: true, accompanying })
}

export async function confirmSigningStage(actor: SigningActor, requestId: string) {
  return confirmSignedStage(createServiceClient(), actor, requestId)
}

/** Turns automatic reminders on or off for one request. */
export async function setRemindersEnabled(actor: SigningActor, requestId: string, enabled: boolean): Promise<SigningRequestSummary> {
  const service = createServiceClient()
  await loadRequestForTenant(service, actor.tenantId, requestId)
  const { data, error } = await service
    .from('signing_requests')
    .update({ reminders_enabled: enabled })
    .eq('id', requestId)
    .eq('tenant_id', actor.tenantId)
    .select('*')
    .single()
  if (error || !data) throw new SigningError(`Could not update reminders: ${error?.message ?? 'not found'}`, 500)
  await logSigningEvent(service, {
    requestId,
    tenantId: actor.tenantId,
    event: enabled ? 'reminders_on' : 'reminders_off',
    actorId: actor.userId,
  })
  return toSigningRequestSummary(data)
}

// ── Send dialog defaults ────────────────────────────────────────────────────

export interface SendDialogQuote {
  id: string
  ref: string | null
  status: string | null
  totalInclGst: number
  signable: boolean
}

export interface SendDialogDefaults {
  jobStage: string | null
  propertyAddress: string | null
  quotes: SendDialogQuote[]
  suggestedQuoteIds: string[]
  suggestedDocumentType: SigningDocumentTypeKey
  suggestedTotalInclGst: number
  signer: { name: string; email: string; phone: string }
  signerSource: 'authority contact' | 'insured' | null
  excess: ExcessContext
}

export async function getSendDialogDefaults(actor: SigningActor, jobId: string): Promise<SendDialogDefaults> {
  const service = createServiceClient()
  const [jobRes, quotesRes] = await Promise.all([
    service.from('jobs').select('*').eq('id', jobId).eq('tenant_id', actor.tenantId).maybeSingle(),
    service.from('quotes').select('*').eq('job_id', jobId).eq('tenant_id', actor.tenantId).order('created_at', { ascending: true }),
  ])
  const job = jobRes.data
  if (!job) throw new SigningError('Job not found', 404)

  const quotes = (quotesRes.data ?? []).filter(q => q.is_active_version !== false)
  const { data: items } = quotes.length
    ? await service.from('scope_items').select('*').in('quote_id', quotes.map(q => q.id)).eq('tenant_id', actor.tenantId)
    : { data: [] }
  const liveItems = (items ?? []).filter(i => i.approval_status !== 'declined')

  const dialogQuotes: SendDialogQuote[] = quotes.map(q => ({
    id: q.id,
    ref: q.quote_ref,
    status: q.status,
    totalInclGst: Math.round(quotesTotalInclGst([q], liveItems) * 100) / 100,
    signable: SIGNABLE_QUOTE_STATUSES.includes(q.status ?? ''),
  }))
  const suggested = dialogQuotes.filter(q => q.signable)
  const total = suggested.reduce((s, q) => s + q.totalInclGst, 0)

  // Signer: the contact with the 'auth' role (who authorises work), else the insured
  const contacts = (Array.isArray(job.contacts) ? job.contacts : []) as unknown as JobContact[]
  const auth = contacts.find(c => c.roles?.includes('auth') && (c.name || c.email))
  const signer = auth
    ? { name: auth.name ?? '', email: auth.email ?? '', phone: auth.phone ?? '' }
    : { name: job.insured_name ?? '', email: job.insured_email ?? '', phone: job.insured_phone ?? '' }

  return {
    jobStage: (job as unknown as { current_stage?: string | null }).current_stage ?? null,
    propertyAddress: job.property_address,
    quotes: dialogQuotes,
    suggestedQuoteIds: suggested.map(q => q.id),
    suggestedDocumentType: suggestDocumentType(total),
    suggestedTotalInclGst: Math.round(total * 100) / 100,
    signer,
    signerSource: auth ? 'authority contact' : job.insured_name || job.insured_email ? 'insured' : null,
    excess: await loadExcessContext(service, actor.tenantId, jobId),
  }
}
