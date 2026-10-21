import { createServiceClient } from '@/lib/supabase/server'
import type { JobContact } from '@/lib/types/contacts'
import { quotesTotalInclGst, SIGNABLE_QUOTE_STATUSES } from '@/lib/documents/quote-document-data'
import { suggestDocumentType } from './documents/catalog'
import { InHouseSigningProvider } from './in-house/provider'
import { confirmSignedStage, markJobSignoffSent } from './job-sync'
import { SigningError, type CreateSigningRequestInput, type SigningActor, type SigningProvider } from './provider'
import { loadRequestForTenant, persistExpiryIfDue } from './repository'
import { downloadSigningPdf } from './storage'
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
  return rows.map(row => toSigningRequestSummary(row))
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
}

/** Create + send in one step. If sending fails the draft is kept so it can be sent again. */
export async function sendForSignature(
  actor: SigningActor,
  input: CreateSigningRequestInput,
  options: { moveJobToAwaitingStage?: boolean } = {},
): Promise<SendForSignatureResult> {
  const p = getSigningProvider()
  const draft = await p.createRequest(actor, input)
  let sent: SigningRequestSummary
  try {
    sent = await p.send(actor, draft.id)
  } catch (err) {
    if (err instanceof SigningError) {
      throw new SigningError(`${err.message} The document was saved as a draft — you can send it from the list.`, err.status)
    }
    throw err
  }

  let stageMoved = false
  if (options.moveJobToAwaitingStage) {
    const service = createServiceClient()
    stageMoved = await markJobSignoffSent(service, await loadRequestForTenant(service, actor.tenantId, sent.id))
  }
  return { request: sent, stageMoved }
}

export async function confirmSigningStage(actor: SigningActor, requestId: string) {
  return confirmSignedStage(createServiceClient(), actor, requestId)
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
  }
}
