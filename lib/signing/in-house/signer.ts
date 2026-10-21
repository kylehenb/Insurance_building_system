import { createServiceClient } from '@/lib/supabase/server'
import { RATE_LIMITS, SUBMIT_GRACE_HOURS } from '@/lib/signing/config'
import { recordSignedDocument } from '@/lib/signing/completion'
import { logSigningEvent } from '@/lib/signing/events'
import { appendCertificatePage } from '@/lib/signing/pdf/certificate'
import { parseDrawnSignature, stampSignatures, type SignatureInput } from '@/lib/signing/pdf/stamp'
import { SigningError } from '@/lib/signing/provider'
import { checkRateLimit } from '@/lib/signing/rate-limit'
import { loadJobAndTenant, loadRequestByTokenHash, persistExpiryIfDue } from '@/lib/signing/repository'
import { ipKey, type RequestMeta } from '@/lib/signing/request-meta'
import { MAX_TYPED_SIGNATURE_LENGTH, SIGNATURE_STYLES } from '@/lib/signing/signature-styles'
import { downloadSigningFile, downloadSigningPdf, excessInvoicePdfPath, pageImagePath, signedPdfPath, uploadSigningPdf } from '@/lib/signing/storage'
import { excessDueText } from '@/lib/excess/decision'
import { hashSigningToken, isWellFormedToken, sha256Hex } from '@/lib/signing/tokens'
import { printedSignerName, SIGNER_CAPACITY_LABELS, type DisplayBlock, type LocatedSignatureField, type PdfRect, type SignerCapacity, type SigningRequestRow } from '@/lib/signing/types'
import { signingDocumentLabel } from '@/lib/signing/documents/catalog'
import { PDFDocument } from 'pdf-lib'

// The signer's side of in-house signing. Everything is reached through the
// link token: its SHA-256 is looked up with the service role, and only that
// one request's document is ever exposed.

export type SignerLinkState = 'not_found' | 'revoked' | 'expired' | 'signed' | 'open'

export interface SignerFieldView {
  id: string
  label: string
  signature?: PdfRect
  date?: PdfRect | null
  name?: PdfRect | null
  representative?: PdfRect | null
}

/** The excess invoice emailed with the request, as shown on the signer page. */
export interface SignerExcessInvoice {
  ref: string | null
  amountIncGst: number
  /** "on receipt" or "by 4 Nov 2026" */
  dueText: string
  /** Only when the office has recorded it paid (accounts are reconciled in batches, so never "unpaid") */
  paidDate: string | null
  bank: { bankName: string | null; accountName: string | null; bsb: string | null; accountNumber: string | null } | null
}

/** Only what the signer page needs. No ids beyond the request, no internals. */
export interface SignerView {
  state: SignerLinkState
  requestId: string | null
  documentName: string | null
  documentTitle: string | null
  signerName: string | null
  /** Owner named on the document (the job's insured), for "signing on behalf of" */
  ownerName: string | null
  propertyAddress: string | null
  companyName: string | null
  expiresAt: string | null
  signedAt: string | null
  /** Signed within the last hour (shows the thank-you screen rather than "already signed") */
  signedRecently: boolean
  display: DisplayBlock[]
  /** Fields in signing order, with where they sit on the page (rects absent on older test fixtures) */
  fields: SignerFieldView[]
  /** Excess invoice sent with this request (open link, or the thank-you screen) */
  excessInvoice: SignerExcessInvoice | null
}

const EMPTY_VIEW: SignerView = {
  state: 'not_found',
  requestId: null,
  documentName: null,
  documentTitle: null,
  signerName: null,
  ownerName: null,
  propertyAddress: null,
  companyName: null,
  expiresAt: null,
  signedAt: null,
  signedRecently: false,
  display: [],
  fields: [],
  excessInvoice: null,
}

const LOCK_TIMEOUT_MS = 2 * 60_000

function withinGrace(row: Pick<SigningRequestRow, 'expires_at' | 'viewed_at'>, now: Date): boolean {
  // Opened before the link expired: allow a little longer to finish signing.
  if (!row.expires_at || !row.viewed_at) return false
  const expires = new Date(row.expires_at).getTime()
  return new Date(row.viewed_at).getTime() < expires && now.getTime() < expires + SUBMIT_GRACE_HOURS * 3600_000
}

/** What a link shows now: open, signed, revoked, expired (after the grace period) or not found. */
export function signerLinkState(row: Pick<SigningRequestRow, 'status' | 'expires_at' | 'viewed_at'>, now = new Date()): SignerLinkState {
  if (row.status === 'signed') return 'signed'
  if (row.status === 'revoked') return 'revoked'
  if (row.status === 'draft') return 'not_found'
  if (row.status === 'expired') return withinGrace(row, now) ? 'open' : 'expired'
  if (row.expires_at && new Date(row.expires_at) <= now && !withinGrace(row, now)) return 'expired'
  return 'open'
}

async function findRow(token: string): Promise<SigningRequestRow | null> {
  if (!isWellFormedToken(token)) return null
  return loadRequestByTokenHash(createServiceClient(), hashSigningToken(token))
}

function fieldsOf(row: SigningRequestRow): LocatedSignatureField[] {
  return Array.isArray(row.fields) ? (row.fields as unknown as LocatedSignatureField[]) : []
}

/** For the signer page. Rate limited per IP; a limited caller sees "not found". */
export async function resolveSignerView(token: string, meta: RequestMeta): Promise<SignerView | 'rate_limited'> {
  const service = createServiceClient()
  if (!(await checkRateLimit(service, `ip:${ipKey(meta.ip)}:view`, RATE_LIMITS.viewPerIp))) return 'rate_limited'

  let row = await findRow(token)
  if (!row) return EMPTY_VIEW
  let state = signerLinkState(row)
  if (state === 'expired') row = await persistExpiryIfDue(service, row)
  if (state === 'not_found') return EMPTY_VIEW

  const { job, tenant } = await loadJobAndTenant(service, row.tenant_id, row.job_id)
  state = signerLinkState(row)
  const base: SignerView = {
    state,
    requestId: row.id,
    documentName: signingDocumentLabel(row.document_type),
    documentTitle: row.document_title,
    signerName: row.signer_name,
    ownerName: job.insured_name,
    propertyAddress: job.property_address,
    companyName: tenant.trading_name || tenant.name,
    expiresAt: row.expires_at,
    signedAt: row.signed_at,
    signedRecently: !!row.signed_at && Date.now() - new Date(row.signed_at).getTime() < 60 * 60_000,
    display: [],
    fields: [],
    excessInvoice: null,
  }
  if (state !== 'open' && !(state === 'signed' && base.signedRecently)) return base
  const excessInvoice = await loadSignerExcessInvoice(service, row, tenant)
  if (state !== 'open') return { ...base, excessInvoice }
  return {
    ...base,
    excessInvoice,
    display: Array.isArray(row.display_content) ? (row.display_content as unknown as DisplayBlock[]) : [],
    fields: fieldsOf(row).map(f => ({
      id: f.id,
      label: f.label,
      signature: f.signature,
      date: f.date,
      name: f.name,
      representative: f.representative ?? null,
    })),
  }
}

async function loadSignerExcessInvoice(
  service: ReturnType<typeof createServiceClient>,
  row: SigningRequestRow,
  tenant: Awaited<ReturnType<typeof loadJobAndTenant>>['tenant'],
): Promise<SignerExcessInvoice | null> {
  if (!row.excess_invoice_id) return null
  const { data: inv } = await service
    .from('invoices')
    .select('invoice_ref, amount_inc_gst, issued_date, paid_date, status')
    .eq('id', row.excess_invoice_id)
    .eq('tenant_id', row.tenant_id)
    .maybeSingle()
  if (!inv || inv.status === 'draft') return null
  const hasBank = !!(tenant.bsb || tenant.account_number)
  return {
    ref: inv.invoice_ref,
    amountIncGst: Number(inv.amount_inc_gst ?? 0),
    dueText: excessDueText(inv.issued_date, tenant.excess_payment_terms),
    paidDate: inv.paid_date,
    bank: hasBank
      ? { bankName: tenant.bank_name, accountName: tenant.account_name, bsb: tenant.bsb, accountNumber: tenant.account_number }
      : null,
  }
}

/** Called by the page's script once it has loaded in a real browser (link scanners don't run it). */
export async function recordSignerView(token: string, meta: RequestMeta): Promise<void> {
  const service = createServiceClient()
  if (!(await checkRateLimit(service, `ip:${ipKey(meta.ip)}:view`, RATE_LIMITS.viewPerIp))) return
  const row = await findRow(token)
  if (!row || signerLinkState(row) !== 'open') return

  const now = new Date().toISOString()
  if (!row.viewed_at || row.status === 'sent') {
    await service
      .from('signing_requests')
      .update({ viewed_at: row.viewed_at ?? now, status: 'viewed' })
      .eq('id', row.id)
      .in('status', ['sent', 'viewed'])
  }
  await logSigningEvent(service, {
    requestId: row.id,
    tenantId: row.tenant_id,
    event: 'viewed',
    ip: meta.ip,
    userAgent: meta.userAgent,
    metadata: { first: !row.viewed_at },
  })
}

/** The exact PDF being signed, while the link is open. */
export async function openSourceDocument(token: string, meta: RequestMeta): Promise<{ pdf: Buffer; filename: string } | null> {
  const service = createServiceClient()
  if (!(await checkRateLimit(service, `ip:${ipKey(meta.ip)}:view`, RATE_LIMITS.viewPerIp))) {
    throw new SigningError('Too many requests. Please wait a few minutes and try again.', 429)
  }
  const row = await findRow(token)
  if (!row || signerLinkState(row) !== 'open') return null
  const pdf = await downloadSigningPdf(service, row.source_pdf_path)
  await logSigningEvent(service, {
    requestId: row.id,
    tenantId: row.tenant_id,
    event: 'document_opened',
    ip: meta.ip,
    userAgent: meta.userAgent,
  })
  return { pdf, filename: `${signingDocumentLabel(row.document_type)}.pdf` }
}

/** Image of page n of the document, while the link is open. */
export async function openPageImage(token: string, pageNumber: number, meta: RequestMeta): Promise<Buffer | null> {
  const service = createServiceClient()
  if (!(await checkRateLimit(service, `ip:${ipKey(meta.ip)}:pages`, RATE_LIMITS.pageImagesPerIp))) {
    throw new SigningError('Too many requests. Please wait a few minutes and try again.', 429)
  }
  const row = await findRow(token)
  if (!row || signerLinkState(row) !== 'open') return null
  const blocks = Array.isArray(row.display_content) ? (row.display_content as unknown as DisplayBlock[]) : []
  const pages = blocks.find((b): b is Extract<DisplayBlock, { type: 'pages' }> => b.type === 'pages')
  if (!pages || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pages.pages.length) return null
  return downloadSigningFile(service, pageImagePath(row.tenant_id, row.id, pageNumber))
}

/**
 * The excess invoice exactly as it was emailed, while the link is open (and
 * for an hour after signing, from the thank-you screen).
 */
export async function openExcessInvoice(token: string, meta: RequestMeta): Promise<{ pdf: Buffer; filename: string } | null> {
  const service = createServiceClient()
  if (!(await checkRateLimit(service, `ip:${ipKey(meta.ip)}:view`, RATE_LIMITS.viewPerIp))) {
    throw new SigningError('Too many requests. Please wait a few minutes and try again.', 429)
  }
  const row = await findRow(token)
  if (!row || !row.excess_invoice_id) return null
  const state = signerLinkState(row)
  const signedRecently = !!row.signed_at && Date.now() - new Date(row.signed_at).getTime() < 60 * 60_000
  if (state !== 'open' && !(state === 'signed' && signedRecently)) return null

  const { data: inv } = await service
    .from('invoices')
    .select('invoice_ref')
    .eq('id', row.excess_invoice_id)
    .eq('tenant_id', row.tenant_id)
    .maybeSingle()
  const pdf = await downloadSigningPdf(service, excessInvoicePdfPath(row.tenant_id, row.id))
  await logSigningEvent(service, {
    requestId: row.id,
    tenantId: row.tenant_id,
    event: 'document_opened',
    ip: meta.ip,
    userAgent: meta.userAgent,
    metadata: { document: 'excess_invoice' },
  })
  return { pdf, filename: `Excess invoice${inv?.invoice_ref ? ` ${inv.invoice_ref}` : ''}.pdf` }
}

export interface SubmitSignatureInput {
  method: string | null
  /** The signer's full name (also the typed signature) */
  typedName: string | null
  style: string | null
  drawnPng: string | null
  /** owner | joint_owner | authorised_person (default owner) */
  capacity?: string | null
}

const CAPACITIES: SignerCapacity[] = ['owner', 'joint_owner', 'authorised_person']

/** The signer's confirmed name. Required for both typed and drawn signatures. */
export function parseSignerName(input: SubmitSignatureInput): string {
  const name = (input.typedName ?? '').trim().replace(/\s+/g, ' ')
  if (name.length < 2) throw new SigningError('Please type your full name to sign.', 400)
  if (name.length > MAX_TYPED_SIGNATURE_LENGTH) throw new SigningError('That name is too long.', 400)
  return name
}

export function parseSignerCapacity(input: SubmitSignatureInput): SignerCapacity {
  return CAPACITIES.find(c => c === input.capacity) ?? 'owner'
}

export function parseSignatureInput(input: SubmitSignatureInput): SignatureInput {
  if (input.method === 'drawn') {
    const png = parseDrawnSignature(input.drawnPng)
    if (!png) throw new SigningError('Please draw your signature, or type your name instead.', 400)
    return { method: 'drawn', png }
  }
  const text = parseSignerName(input)
  const style = SIGNATURE_STYLES.find(s => s.key === input.style)?.key ?? SIGNATURE_STYLES[0].key
  return { method: 'typed', text, styleKey: style }
}

/**
 * Signs: stamps every field, appends the Signature Certificate, stores the
 * signed PDF privately, then files copies and emails them. The link is
 * single-use: a row lock (signing_locked_at) and a status check make a second
 * submission fail even if it arrives at the same moment.
 */
export async function submitSignature(token: string, input: SubmitSignatureInput, meta: RequestMeta): Promise<{ requestId: string }> {
  const service = createServiceClient()
  const ipOk = await checkRateLimit(service, `ip:${ipKey(meta.ip)}:submit`, RATE_LIMITS.submitPerIp)
  if (!isWellFormedToken(token)) throw new SigningError('This link isn’t valid.', 404)
  const tokenOk = await checkRateLimit(service, `token:${hashSigningToken(token).slice(0, 32)}:submit`, RATE_LIMITS.submitPerToken)
  if (!ipOk || !tokenOk) throw new SigningError('Too many attempts. Please wait a few minutes and try again.', 429)

  const row = await findRow(token)
  if (!row) throw new SigningError('This link isn’t valid.', 404)
  const state = signerLinkState(row)
  if (state === 'signed') throw new SigningError('This document has already been signed.', 409)
  if (state === 'revoked') throw new SigningError('This signing link has been cancelled.', 410)
  if (state !== 'open') throw new SigningError('This signing link has expired.', 410)

  const signature = parseSignatureInput(input)
  const signedName = parseSignerName(input)
  const capacity = parseSignerCapacity(input)
  const fields = fieldsOf(row)
  if (fields.length === 0) throw new SigningError('This document has no signature boxes. Please contact us.', 500)

  // Claim the request (single use)
  const nowIso = new Date().toISOString()
  const staleLock = new Date(Date.now() - LOCK_TIMEOUT_MS).toISOString()
  const { data: claimed } = await service
    .from('signing_requests')
    .update({ signing_locked_at: nowIso })
    .eq('id', row.id)
    .in('status', ['sent', 'viewed', 'expired'])
    .or(`signing_locked_at.is.null,signing_locked_at.lt.${staleLock}`)
    .select('*')
    .maybeSingle()
  if (!claimed) throw new SigningError('This document is already being signed. Please wait a moment and refresh.', 409)

  const signedAt = new Date()
  try {
    const sourcePdf = await downloadSigningPdf(service, claimed.source_pdf_path)
    if (sha256Hex(sourcePdf) !== claimed.source_pdf_sha256) {
      throw new Error('Source PDF hash does not match the stored hash')
    }
    const { job, tenant } = await loadJobAndTenant(service, claimed.tenant_id, claimed.job_id)
    const stamped = await stampSignatures({
      sourcePdf: new Uint8Array(sourcePdf),
      fields,
      signature,
      printedName: printedSignerName(signedName, capacity, job.insured_name),
      representativeName: capacity === 'authorised_person' ? signedName : null,
      signedAt,
      requestId: claimed.id,
    })
    const stampedSha256 = sha256Hex(stamped)
    const documentPageCount = (await PDFDocument.load(stamped)).getPageCount()

    const finalPdf = await appendCertificatePage(stamped, {
      requestId: claimed.id,
      documentTitle: claimed.document_title,
      jobNumber: job.job_number,
      propertyAddress: job.property_address,
      companyName: tenant.trading_name || tenant.name,
      signerName: signedName,
      signedAs: capacity === 'authorised_person' && job.insured_name
        ? `${SIGNER_CAPACITY_LABELS[capacity]} (${job.insured_name}). The signer confirmed they have the owner's authority to sign.`
        : SIGNER_CAPACITY_LABELS[capacity],
      addressedTo: claimed.signer_name,
      signerEmail: claimed.signer_email,
      signerPhone: claimed.signer_phone,
      signatureMethod: signature.method,
      createdAt: new Date(claimed.created_at),
      sentAt: claimed.sent_at ? new Date(claimed.sent_at) : null,
      viewedAt: claimed.viewed_at ? new Date(claimed.viewed_at) : signedAt,
      signedAt,
      ip: meta.ip,
      userAgent: meta.userAgent,
      sourceSha256: claimed.source_pdf_sha256,
      stampedSha256,
      documentPageCount,
    })
    const signedSha256 = sha256Hex(finalPdf)
    const path = signedPdfPath(claimed.tenant_id, claimed.id)
    await service.storage.from('signed-documents').remove([path]) // leftover from an interrupted attempt, if any
    await uploadSigningPdf(service, path, finalPdf)

    const { data: signedRow, error } = await service
      .from('signing_requests')
      .update({
        status: 'signed',
        signed_at: signedAt.toISOString(),
        viewed_at: claimed.viewed_at ?? signedAt.toISOString(),
        signed_pdf_path: path,
        signed_pdf_sha256: signedSha256,
        signature_method: signature.method,
        signature_text: signature.method === 'typed' ? signature.text : null,
        signature_style: signature.method === 'typed' ? signature.styleKey : null,
        signer_ip: meta.ip,
        signer_user_agent: meta.userAgent,
        signed_name: signedName,
        signer_capacity: capacity,
        signing_locked_at: null,
      })
      .eq('id', claimed.id)
      .in('status', ['sent', 'viewed', 'expired'])
      .select('*')
      .maybeSingle()
    if (error || !signedRow) throw new Error(`Saving the signature failed: ${error?.message ?? 'request changed (revoked?)'}`)

    await logSigningEvent(service, {
      requestId: claimed.id,
      tenantId: claimed.tenant_id,
      event: 'signed',
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: {
        signedName,
        capacity,
        method: signature.method,
        style: signature.method === 'typed' ? signature.styleKey : null,
        sourceSha256: claimed.source_pdf_sha256,
        stampedSha256,
        signedSha256,
        fields: fields.map(f => f.id),
      },
    })

    try {
      await recordSignedDocument(service, signedRow, finalPdf)
    } catch (err) {
      // The signature is stored; filing/emailing problems are for the office.
      console.error(`[signing] post-signing steps failed for ${claimed.id}:`, err)
    }
    return { requestId: claimed.id }
  } catch (err) {
    await service.from('signing_requests').update({ signing_locked_at: null }).eq('id', claimed.id).neq('status', 'signed')
    await logSigningEvent(service, {
      requestId: claimed.id,
      tenantId: claimed.tenant_id,
      event: 'sign_failed',
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { error: err instanceof Error ? err.message : String(err) },
    })
    console.error(`[signing] signing ${claimed.id} failed:`, err)
    if (err instanceof SigningError) throw err
    throw new SigningError('Sorry, something went wrong while signing. Nothing was signed — please try again.', 500)
  }
}
