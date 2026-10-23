import type { Database, Json } from '@/lib/supabase/database.types'
import { createServiceClient } from '@/lib/supabase/server'
import { documentTemplateVars, renderTemplate, resolveEmailTemplate } from '@/lib/email/templates'
import { renderRichTemplate, richToText } from '@/lib/email/rich-text'
import { composeStandardEmail } from '@/lib/email/compose'
import { resolveInsurerEmailRecipients } from '@/lib/contacts/email-routing'
import { sendEmailViaGmail } from '@/lib/signing/email/gmail'
import type { PrintDataContext } from '@/lib/documents/print-data'
import { reportDocumentName } from '@/lib/documents/print-document-pdfs'
import { PrintDataError } from '@/lib/documents/print-data'
import {
  documentRefKey,
  DocumentSendError,
  markDocumentSent,
  prepareDocument,
  type DocumentRef,
  type PreparedDocument,
  type StatusChange,
} from '@/lib/documents/send/documents'

// Emailing documents from a job (quotes, reports, invoices, TCC, photos).
// The first document picks the email template and the recipients; any others
// ride along as extra attachments (e.g. BAR + quote + photos to the insurer).
// Auto send uses the template as-is; Customise send edits a copy of it.
// Nothing changes on the documents until Gmail has accepted the email.

type Job = Database['public']['Tables']['jobs']['Row']

const FALLBACK_FROM = 'office@insurancerepairco.com.au'
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/
/** Gmail's limit is 25 MB including encoding overhead (~4/3) */
export const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024
export const MAX_DOCUMENTS_PER_EMAIL = 8

export interface DocumentEmailContext extends PrintDataContext {
  /** The signed-in user sending, recorded on the job's comms log */
  actorId: string | null
}

export interface DocumentEmailAttachment {
  ref: DocumentRef
  filename: string
  title: string
}

export interface DocumentEmailDraft {
  to: string
  cc: string
  subject: string
  /** Rich text (the editor's HTML). {signature} is filled in when sent. */
  body: string
  /** Plain-text version of body (for the voice connector) */
  bodyText: string
  attachments: DocumentEmailAttachment[]
  /** Who the template addresses by default */
  audience: 'insurer' | 'insured'
  templateName: string
  /** True when the tenant hasn't written a template for this document yet */
  usingBuiltInTemplate: boolean
  warnings: string[]
  /** Other documents on the job that can be attached as well */
  otherDocuments: DocumentEmailAttachment[]
}

export interface DocumentEmailOverrides {
  to?: string
  cc?: string
  subject?: string
  /** Rich text from Customise send, or plain text from the voice connector */
  body?: string
}

export interface DocumentSendResult {
  communicationId: string | null
  statusChanges: StatusChange[]
}

/** Splits a comma/semicolon separated address list and validates each one. */
export function parseAddressList(value: string | undefined | null): string[] {
  const list = (value ?? '').split(/[,;]/).map(s => s.trim()).filter(Boolean)
  const bad = list.find(e => !EMAIL_RE.test(e))
  if (bad) throw new DocumentSendError(`"${bad}" is not a valid email address`, 400)
  return [...new Set(list)]
}

/** Loads every document, checking they all belong to the same job. */
async function prepareAll(refs: DocumentRef[], ctx: PrintDataContext): Promise<PreparedDocument[]> {
  const seen = new Set<string>()
  const unique = refs.filter(ref => {
    const key = documentRefKey(ref)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (unique.length === 0) throw new DocumentSendError('Choose a document to send', 400)
  if (unique.length > MAX_DOCUMENTS_PER_EMAIL) {
    throw new DocumentSendError(`Send at most ${MAX_DOCUMENTS_PER_EMAIL} documents in one email`, 400)
  }

  const docs: PreparedDocument[] = []
  for (const ref of unique) {
    try {
      docs.push(await prepareDocument(ref, ctx))
    } catch (err) {
      if (err instanceof PrintDataError) throw new DocumentSendError(err.message, err.status)
      throw err
    }
  }
  const jobId = docs[0].job.id
  if (docs.some(d => d.job.id !== jobId)) {
    throw new DocumentSendError('All documents in one email must belong to the same job', 400)
  }
  return docs
}

/** Default To/Cc: the insurer routing (WF-5) or, for an excess invoice, the insured. */
async function defaultRecipients(ctx: PrintDataContext, job: Job, audience: 'insurer' | 'insured') {
  if (audience === 'insured') {
    return { to: job.insured_email?.trim() ? [job.insured_email.trim()] : [], cc: [] as string[], contactName: null }
  }
  const { data: client } = job.client_id
    ? await ctx.supabase.from('clients').select('submission_email, adjuster_submission_email')
        .eq('id', job.client_id).eq('tenant_id', ctx.tenantId).maybeSingle()
    : { data: null }
  const { to, cc } = resolveInsurerEmailRecipients({
    orderSenderEmail: job.order_sender_email?.trim() || null,
    orderSenderName: job.order_sender_name,
    adjusterSubmissionEmail: client?.adjuster_submission_email?.trim() || null,
    insurerSubmissionEmail: client?.submission_email?.trim() || null,
  })
  // "Hi Casey," when it goes to the person who sent the order, else "Hi team,"
  const contactName = to[0] && to[0] === job.order_sender_email?.trim()
    ? job.order_sender_name?.trim().split(/\s+/)[0] || null
    : null
  return { to, cc, contactName }
}

async function buildDraft(docs: PreparedDocument[], ctx: PrintDataContext): Promise<DocumentEmailDraft> {
  const main = docs[0]
  const { job, tenant } = main
  const template = await resolveEmailTemplate(ctx.supabase, ctx.tenantId, main.sendType, job.client_id)
  const { to, cc, contactName } = await defaultRecipients(ctx, job, main.audience)
  const vars = { ...documentTemplateVars({ job, tenant, contactName }), ...main.vars }

  const warnings = docs.flatMap(d => d.warnings)
  if (to.length === 0) {
    warnings.unshift(main.audience === 'insured'
      ? 'The insured has no email address on the job. Use Customise send to enter one.'
      : 'No insurer email found (order sender or client submission email). Use Customise send to enter one.')
  }

  const body = renderRichTemplate(template.body, vars)
  return {
    to: to.join(', '),
    cc: cc.join(', '),
    subject: renderTemplate(template.subject, vars),
    body,
    bodyText: richToText(body),
    attachments: docs.map(d => ({ ref: d.ref, filename: d.filename, title: d.title })),
    audience: main.audience,
    templateName: template.name,
    usingBuiltInTemplate: template.templateId === null,
    warnings,
    otherDocuments: (await listJobDocuments(ctx, job.id)).filter(o => !docs.some(d => documentRefKey(d.ref) === documentRefKey(o.ref))),
  }
}

/** The job's quotes, reports and invoices, for "Attach another document" (and the voice connector's document list). */
export async function listJobDocuments(ctx: PrintDataContext, jobId: string): Promise<DocumentEmailAttachment[]> {
  const { supabase, tenantId } = ctx
  const [quotes, reports, invoices] = await Promise.all([
    supabase.from('quotes').select('id, quote_ref, is_active_version, created_at')
      .eq('job_id', jobId).eq('tenant_id', tenantId).order('created_at', { ascending: true }),
    supabase.from('reports').select('id, report_ref, report_type, deleted_at, created_at')
      .eq('job_id', jobId).eq('tenant_id', tenantId).is('deleted_at', null).order('created_at', { ascending: true }),
    supabase.from('invoices').select('id, invoice_ref, invoice_type, status, direction, created_at')
      .eq('job_id', jobId).eq('tenant_id', tenantId).eq('direction', 'outbound').order('created_at', { ascending: true }),
  ])
  const list: DocumentEmailAttachment[] = []
  for (const q of quotes.data ?? []) {
    if (q.is_active_version === false) continue
    list.push({ ref: { kind: 'quote', id: q.id }, title: `Quote ${q.quote_ref || 'Draft'}`, filename: '' })
  }
  for (const r of reports.data ?? []) {
    list.push({ ref: { kind: 'report', id: r.id }, title: `${reportDocumentName(r.report_type)}${r.report_ref ? ` ${r.report_ref}` : ''}`, filename: '' })
  }
  for (const i of invoices.data ?? []) {
    if (i.status === 'voided') continue
    list.push({ ref: { kind: 'invoice', id: i.id }, title: `${i.invoice_type === 'excess' ? 'Excess invoice' : 'Invoice'} ${i.invoice_ref ?? ''}`.trim(), filename: '' })
  }
  return list
}

/** The pre-filled email for the send dialog. Renders no PDFs. */
export async function buildDocumentEmailDraft(refs: DocumentRef[], ctx: PrintDataContext): Promise<DocumentEmailDraft> {
  return buildDraft(await prepareAll(refs, ctx), ctx)
}

function storageName(filename: string): string {
  return filename.replace(/[^\w.,\- ]/g, '_')
}

/**
 * Renders the documents, emails them, records the email on the job (with a
 * copy of each PDF), then marks the documents sent. Overrides come from
 * Customise send; Auto send passes none.
 */
export async function sendDocumentEmail(
  refs: DocumentRef[],
  ctx: DocumentEmailContext,
  overrides: DocumentEmailOverrides = {},
): Promise<DocumentSendResult> {
  const docs = await prepareAll(refs, ctx)
  const draft = await buildDraft(docs, ctx)
  const main = docs[0]

  const to = parseAddressList(overrides.to ?? draft.to)
  const cc = parseAddressList(overrides.cc ?? draft.cc).filter(e => !to.includes(e))
  const subject = (overrides.subject ?? draft.subject).trim()
  const { html, text: body } = composeStandardEmail(overrides.body ?? draft.body, main.tenant)
  if (to.length === 0) throw new DocumentSendError('Add a recipient — use Customise send to enter an email address', 422)
  if (!subject) throw new DocumentSendError('Subject is required', 400)

  // One at a time: they share one headless browser
  const files: { doc: PreparedDocument; pdf: Buffer }[] = []
  for (const doc of docs) {
    try {
      files.push({ doc, pdf: await doc.render() })
    } catch (err) {
      console.error(`[document-send] PDF failed for ${doc.ref.kind} ${doc.ref.id}:`, err)
      throw new DocumentSendError(`Could not create the PDF for ${doc.title}. Nothing was sent.`, 500)
    }
  }
  const totalBytes = files.reduce((sum, f) => sum + f.pdf.length, 0)
  if (totalBytes > MAX_ATTACHMENT_BYTES) {
    throw new DocumentSendError(
      `The attachments come to ${(totalBytes / 1024 / 1024).toFixed(1)} MB, more than email allows. Send fewer documents or photos at a time.`,
      413,
    )
  }

  const service = createServiceClient()
  const fromEmail = main.tenant.contact_email ?? FALLBACK_FROM
  let sent
  try {
    sent = await sendEmailViaGmail(service, {
      from: fromEmail,
      to: to.join(', '),
      cc: cc.length ? cc.join(', ') : undefined,
      subject,
      text: body,
      html,
      attachments: files.map(f => ({ filename: f.doc.filename, mimeType: 'application/pdf', content: f.pdf })),
    })
  } catch (err) {
    console.error(`[document-send] Gmail send failed (${docs.map(d => d.title).join(', ')}):`, err)
    throw new DocumentSendError('Failed to send the email. Nothing was sent or changed.', 502)
  }

  // Keep a copy of exactly what was sent on the comms record. Non-fatal from
  // here on: the email has gone.
  const communicationId = crypto.randomUUID()
  const attachments = await Promise.all(files.map(async ({ doc, pdf }, i) => {
    const storagePath = `tenants/${ctx.tenantId}/comms/${communicationId}/${Date.now()}-${i}-${storageName(doc.filename)}`
    const { error } = await service.storage.from('job-files').upload(storagePath, pdf, { contentType: 'application/pdf' })
    if (error) console.error(`[document-send] PDF copy upload failed for ${doc.ref.kind} ${doc.ref.id}:`, error)
    return { filename: doc.filename, storage_path: error ? null : storagePath, mime_type: 'application/pdf', size_bytes: pdf.length }
  }))

  const { error: commErr } = await service.from('communications').insert({
    id:               communicationId,
    tenant_id:        ctx.tenantId,
    job_id:           main.job.id,
    type:             'email',
    direction:        'outbound',
    contact_type:     main.audience,
    contact_detail:   to.join(', '),
    subject,
    content:          body,
    body_text:        body,
    from_email:       fromEmail,
    to_email:         [...to, ...cc].join(', '),
    thread_id:        sent.threadId,
    gmail_message_id: sent.gmailId,
    attachments:      attachments as unknown as Json,
    source:           'document_send',
    created_by:       ctx.actorId,
  })
  if (commErr) console.error('[document-send] communications insert failed:', commErr)

  const statusChanges: StatusChange[] = []
  for (const doc of docs) {
    const change = await markDocumentSent(service, ctx.tenantId, doc)
    if (change) statusChanges.push(change)
  }
  return { communicationId: commErr ? null : communicationId, statusChanges }
}

/**
 * "Mark as sent" without emailing — for documents sent some other way
 * (insurer portal, the old print page). Records a note on the job.
 */
export async function markDocumentsSentWithoutEmail(refs: DocumentRef[], ctx: DocumentEmailContext): Promise<DocumentSendResult> {
  const docs = await prepareAll(refs, ctx)
  const service = createServiceClient()
  const statusChanges: StatusChange[] = []
  for (const doc of docs) {
    const change = await markDocumentSent(service, ctx.tenantId, doc)
    if (change) statusChanges.push(change)
  }
  if (statusChanges.length > 0) {
    const { error } = await service.from('communications').insert({
      tenant_id:  ctx.tenantId,
      job_id:     docs[0].job.id,
      type:       'portal',
      direction:  'outbound',
      subject:    'Marked as sent (not emailed from the system)',
      content:    statusChanges.map(c => c.description).join('\n'),
      body_text:  statusChanges.map(c => c.description).join('\n'),
      source:     'document_send',
      created_by: ctx.actorId,
    })
    if (error) console.error('[document-send] mark-sent note insert failed:', error)
  }
  return { communicationId: null, statusChanges }
}

