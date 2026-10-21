import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { renderTemplate, resolveEmailTemplate, signingTemplateVars } from '@/lib/email/templates'
import { appBaseUrl, SIGNER_CONTACT } from '@/lib/signing/config'
import { signingDocumentLabel } from '@/lib/signing/documents/catalog'
import { formatPerthDateTime, formatSigningDate } from '@/lib/signing/format'
import type { SigningRequestRow } from '@/lib/signing/types'
import { renderBrandedEmailHtml } from './html'
import { sendEmailViaGmail, type SentEmail } from './gmail'

// The emails the signing module sends:
//   1. Signature request (template 'signing_request') — link to sign
//   2. Signed copy to the signer (template 'signing_completed') — PDF attached,
//      office BCC'd (office gets its own copy only if the signer can't be emailed)
// Both templates are editable in Settings → Email Templates.

type Service = SupabaseClient<Database>
type Job = Database['public']['Tables']['jobs']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']

const FALLBACK_FROM = SIGNER_CONTACT.email
const LINK_PLACEHOLDER = '[secure signing link]'

export class SigningEmailError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SigningEmailError'
  }
}

function senderFor(tenant: Tenant): string {
  return tenant.contact_email?.trim() || FALLBACK_FROM
}

function companyName(tenant: Tenant): string {
  return tenant.trading_name || tenant.name
}

function logoUrlFor(tenant: Tenant): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (tenant.logo_storage_path && base) {
    return `${base}/storage/v1/object/public/tenant-assets/${tenant.logo_storage_path.split('/').map(encodeURIComponent).join('/')}`
  }
  return `${appBaseUrl()}/logo-alt.png`
}

function footerLines(tenant: Tenant): string[] {
  return [
    `${companyName(tenant)} · ${tenant.contact_phone ? tenant.contact_phone.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3') : SIGNER_CONTACT.phone} · ${senderFor(tenant)}`,
    'You received this email because Insurance Repair Co is carrying out insurance repairs at your property.',
  ]
}

async function recordOutboundEmail(service: Service, params: {
  request: SigningRequestRow
  sent: SentEmail
  from: string
  to: string
  subject: string
  text: string
  source: string
  actorId: string | null
  attachments?: { filename: string; storage_path: string | null; mime_type: string; size_bytes: number }[]
}): Promise<void> {
  const { error } = await service.from('communications').insert({
    tenant_id: params.request.tenant_id,
    job_id: params.request.job_id,
    type: 'email',
    direction: 'outbound',
    contact_type: 'insured',
    contact_name: params.request.signer_name,
    contact_detail: params.to,
    subject: params.subject,
    content: params.text,
    body_text: params.text,
    from_email: params.from,
    to_email: params.to,
    thread_id: params.sent.threadId,
    gmail_message_id: params.sent.gmailId,
    attachments: (params.attachments ?? []) as unknown as Json,
    source: params.source,
    created_by: params.actorId,
  })
  if (error) console.error(`[signing] communications insert (${params.source}) failed for ${params.request.id}:`, error)
}

export type RequestEmailKind = 'initial' | 'resend' | 'reminder'

/**
 * Emails the signing link. The raw link is only in the email itself: the
 * communications record keeps the text with the link replaced.
 */
export async function sendSigningRequestEmail(service: Service, params: {
  request: SigningRequestRow
  job: Job
  tenant: Tenant
  signingLink: string
  kind: RequestEmailKind
  actorId: string | null
}): Promise<SentEmail> {
  const { request, job, tenant, signingLink, kind } = params
  const to = request.signer_email?.trim()
  if (!to) throw new SigningEmailError('The signer has no email address')

  const template = await resolveEmailTemplate(service, tenant.id, 'signing_request', job.client_id)
  const documentName = signingDocumentLabel(request.document_type)
  const vars = signingTemplateVars({
    signerName: request.signer_name,
    documentName,
    job,
    tenant,
    signingLink,
    expiryDate: request.expires_at ? formatSigningDate(request.expires_at) : '',
  })

  let body = renderTemplate(template.body, vars)
  // The link is the whole point of this email: add it if a template lost it
  if (!body.includes(signingLink)) body = `${body.trimEnd()}\n\n${signingLink}\n`
  let subject = renderTemplate(template.subject, vars).trim() || `Please sign your ${documentName}`
  if (kind === 'reminder') subject = `Reminder: ${subject}`

  const from = senderFor(tenant)
  const html = renderBrandedEmailHtml({
    text: body,
    actionUrl: signingLink,
    actionLabel: `Review and sign`,
    logoUrl: logoUrlFor(tenant),
    companyName: companyName(tenant),
    footerLines: footerLines(tenant),
  })

  const sent = await sendEmailViaGmail(service, { from, to, subject, text: body, html })
  await recordOutboundEmail(service, {
    request,
    sent,
    from,
    to,
    subject,
    text: body.split(signingLink).join(LINK_PLACEHOLDER),
    source: kind === 'reminder' ? 'signing_reminder' : 'signing_request',
    actorId: params.actorId,
  })
  return sent
}

/**
 * The signed copy: emailed to the signer with the office BCC'd, so the office
 * gets exactly what the signer got. If the signer has no email address or
 * that send fails, the office is sent its own copy instead, so the office
 * always receives the signed document.
 */
export async function sendSignedCopyEmails(service: Service, params: {
  request: SigningRequestRow
  job: Job
  tenant: Tenant
  signedPdf: Uint8Array
  filename: string
  jobFileStoragePath: string | null
  signedPdfSha256: string
}): Promise<{ signerSent: boolean; officeSent: boolean; errors: string[] }> {
  const { request, job, tenant, signedPdf, filename } = params
  const from = senderFor(tenant)
  const officeAddress = senderFor(tenant)
  const documentName = signingDocumentLabel(request.document_type)
  const attachment = { filename, mimeType: 'application/pdf', content: Buffer.from(signedPdf) }
  const commAttachment = [{ filename, storage_path: params.jobFileStoragePath, mime_type: 'application/pdf', size_bytes: signedPdf.length }]
  const errors: string[] = []
  let signerSent = false
  let officeSent = false

  // 1. Signer copy, office BCC'd
  const to = request.signer_email?.trim()
  if (to) {
    try {
      const template = await resolveEmailTemplate(service, tenant.id, 'signing_completed', job.client_id)
      const vars = signingTemplateVars({
        signerName: request.signed_name || request.signer_name,
        documentName,
        job,
        tenant,
        signedAt: request.signed_at ? formatPerthDateTime(request.signed_at) : '',
      })
      const body = renderTemplate(template.body, vars)
      const subject = renderTemplate(template.subject, vars).trim() || `Your signed ${documentName}`
      const html = renderBrandedEmailHtml({
        text: body,
        logoUrl: logoUrlFor(tenant),
        companyName: companyName(tenant),
        footerLines: footerLines(tenant),
      })
      const bcc = to.toLowerCase() === officeAddress.toLowerCase() ? undefined : officeAddress
      const sent = await sendEmailViaGmail(service, { from, to, bcc, subject, text: body, html, attachments: [attachment] })
      await recordOutboundEmail(service, {
        request, sent, from, to, subject, text: body, source: 'signing_signed_copy', actorId: null, attachments: commAttachment,
      })
      signerSent = true
      officeSent = true
    } catch (err) {
      console.error(`[signing] signed copy to signer failed for ${request.id}:`, err)
      errors.push('signer')
    }
  }

  // 2. Fallback: the office's own copy when the signer couldn't be emailed
  if (!officeSent) {
    try {
      const subject = `Signed: ${documentName} – ${job.property_address ?? job.job_number} (${job.job_number})`
      const text = [
        `${request.signed_name || request.signer_name} has signed the ${documentName} for ${job.property_address ?? job.job_number}.`,
        to ? 'The signed copy could not be emailed to the signer — please send it to them.' : 'The signer has no email address — please give them a copy of the signed document.',
        '',
        `Job: ${job.job_number}`,
        `Signed: ${request.signed_at ? formatPerthDateTime(request.signed_at) : '—'}`,
        `Request ID: ${request.id}`,
        `SHA-256 of the signed PDF: ${params.signedPdfSha256}`,
        '',
        `${appBaseUrl()}/dashboard/jobs/${job.id}`,
      ].join('\n')
      await sendEmailViaGmail(service, { from, to: officeAddress, subject, text, attachments: [attachment] })
      officeSent = true
    } catch (err) {
      console.error(`[signing] office copy failed for ${request.id}:`, err)
      errors.push('office')
    }
  }

  return { signerSent, officeSent, errors }
}
