import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

// Email templates live in the email_templates table, one default per
// send_type, optionally overridden per client. Until a tenant has written
// one, the built-in defaults below are used so sends still work.

export type EmailSendType = 'work_order' | 'signing_request' | 'signing_request_excess' | 'signing_completed'

export interface EmailTemplateContent {
  subject: string
  body: string
}

export interface ResolvedEmailTemplate extends EmailTemplateContent {
  /** email_templates.id, or null when the built-in default was used */
  templateId: string | null
  name: string
}

export const BUILT_IN_TEMPLATES: Record<EmailSendType, EmailTemplateContent & { name: string }> = {
  work_order: {
    name: 'Work order — default',
    subject: 'Work Order {work_order_ref} - {property_address} ({job_number})',
    body: [
      'Hi {trade_contact},',
      '',
      'Please find attached work order {work_order_ref} for {trade_type} works at {property_address}.',
      '',
      'Job: {job_number}',
      'Insured: {insured_name}',
      '',
      'The attached PDF sets out the scope of works and the agreed amount. Please reply to this email to confirm you accept the work order and let us know your earliest availability.',
      '',
      'Kind regards,',
      '{company_name}',
    ].join('\n'),
  },
  signing_request: {
    name: 'Signature request — default',
    subject: 'Please sign your {document_name} – {property_address}',
    body: [
      'Hi {signer_first_name},',
      '',
      '{company_name} is ready to start the repairs at {property_address}. Before we can begin, please read and sign your {document_name}.',
      '',
      '{signing_link}',
      '',
      'It takes about two minutes on your phone or computer. You don\'t need an account or a password: tap the button, read the document, and sign by typing your name or with your finger.',
      '',
      'The link works until {expiry_date}. If you have any questions, call us on {company_phone} or reply to this email.',
      '',
      'Kind regards,',
      '{company_name}',
    ].join('\n'),
  },
  signing_request_excess: {
    name: 'Signature request with excess invoice — default',
    subject: 'Please sign your {document_name} and pay your excess – {property_address}',
    body: [
      'Hi {signer_first_name},',
      '',
      '{company_name} is ready to start the repairs at {property_address}. Before we can begin, there are two things to do:',
      '',
      '1. Read and sign your {document_name}:',
      '',
      '{signing_link}',
      '',
      '2. Pay your insurance excess of {excess_amount}. The excess invoice ({invoice_ref}) is attached to this email with our bank details. Payment is due {excess_due}.',
      '',
      'Signing takes about two minutes on your phone or computer. You don\'t need an account or a password.',
      '',
      'The signing link works until {expiry_date}. If you have any questions, call us on {company_phone} or reply to this email.',
      '',
      'Kind regards,',
      '{company_name}',
    ].join('\n'),
  },
  signing_completed: {
    name: 'Signed copy — default',
    subject: 'Your signed {document_name} – {property_address}',
    body: [
      'Hi {signer_first_name},',
      '',
      'Thank you for signing your {document_name} for {property_address}. Your signed copy is attached to this email for your records.',
      '',
      'Signed: {signed_at}',
      '',
      'If you have any questions, call us on {company_phone} or reply to this email.',
      '',
      'Kind regards,',
      '{company_name}',
    ].join('\n'),
  },
}

export interface TemplateToken {
  key: string
  label: string
  /** Shown in the preview when there's no real record to fill it from */
  example: string
}

/** Placeholders each send type supports, for substitution and the template editor. */
export const TEMPLATE_TOKENS: Record<EmailSendType, TemplateToken[]> = {
  work_order: [
    { key: 'trade_contact',    label: 'Trade contact',    example: 'Dave' },
    { key: 'trade_name',       label: 'Trade business',   example: 'Smith Plumbing Pty Ltd' },
    { key: 'trade_type',       label: 'Trade type',       example: 'Plumber' },
    { key: 'work_order_ref',   label: 'Work order ref',   example: 'WO-1042' },
    { key: 'job_number',       label: 'Job number',       example: 'IRC1042' },
    { key: 'claim_number',     label: 'Claim number',     example: 'CLM-558213' },
    { key: 'insured_name',     label: 'Insured name',     example: 'Jane Citizen' },
    { key: 'property_address', label: 'Property address', example: '12 Example St, Perth WA 6000' },
    { key: 'company_name',     label: 'Your company',     example: 'Insurance Repair Co' },
  ],
  signing_request: [
    { key: 'signing_link',     label: 'Signing link',     example: 'https://app.example.com/sign/…' },
    { key: 'expiry_date',      label: 'Link expiry date', example: '3 Nov 2026' },
    { key: 'signer_first_name', label: 'Signer first name', example: 'Jane' },
    { key: 'signer_name',      label: 'Signer full name', example: 'Jane Citizen' },
    { key: 'document_name',    label: 'Document name',    example: 'Scope of Works Authorisation' },
    { key: 'property_address', label: 'Property address', example: '12 Example St, Perth WA 6000' },
    { key: 'job_number',       label: 'Job number',       example: 'IRC1042' },
    { key: 'claim_number',     label: 'Claim number',     example: 'CLM-558213' },
    { key: 'insured_name',     label: 'Insured name',     example: 'Jane Citizen' },
    { key: 'company_name',     label: 'Your company',     example: 'Insurance Repair Co' },
    { key: 'company_phone',    label: 'Your phone',       example: '0431 132 077' },
    { key: 'company_email',    label: 'Your email',       example: 'office@insurancerepairco.com.au' },
  ],
  signing_request_excess: [
    { key: 'signing_link',     label: 'Signing link',     example: 'https://app.example.com/sign/…' },
    { key: 'expiry_date',      label: 'Link expiry date', example: '3 Nov 2026' },
    { key: 'excess_amount',    label: 'Excess amount',    example: '$500.00' },
    { key: 'invoice_ref',      label: 'Invoice number',   example: 'INV-IRC1042-2' },
    { key: 'excess_due',       label: 'Excess due',       example: 'on receipt' },
    { key: 'signer_first_name', label: 'Signer first name', example: 'Jane' },
    { key: 'signer_name',      label: 'Signer full name', example: 'Jane Citizen' },
    { key: 'document_name',    label: 'Document name',    example: 'Scope of Works Authorisation' },
    { key: 'property_address', label: 'Property address', example: '12 Example St, Perth WA 6000' },
    { key: 'job_number',       label: 'Job number',       example: 'IRC1042' },
    { key: 'claim_number',     label: 'Claim number',     example: 'CLM-558213' },
    { key: 'insured_name',     label: 'Insured name',     example: 'Jane Citizen' },
    { key: 'company_name',     label: 'Your company',     example: 'Insurance Repair Co' },
    { key: 'company_phone',    label: 'Your phone',       example: '0431 132 077' },
    { key: 'company_email',    label: 'Your email',       example: 'office@insurancerepairco.com.au' },
  ],
  signing_completed: [
    { key: 'signed_at',        label: 'Signed date/time', example: '21 Oct 2026, 2:05 pm' },
    { key: 'signer_first_name', label: 'Signer first name', example: 'Jane' },
    { key: 'signer_name',      label: 'Signer full name', example: 'Jane Citizen' },
    { key: 'document_name',    label: 'Document name',    example: 'Scope of Works Authorisation' },
    { key: 'property_address', label: 'Property address', example: '12 Example St, Perth WA 6000' },
    { key: 'job_number',       label: 'Job number',       example: 'IRC1042' },
    { key: 'claim_number',     label: 'Claim number',     example: 'CLM-558213' },
    { key: 'insured_name',     label: 'Insured name',     example: 'Jane Citizen' },
    { key: 'company_name',     label: 'Your company',     example: 'Insurance Repair Co' },
    { key: 'company_phone',    label: 'Your phone',       example: '0431 132 077' },
    { key: 'company_email',    label: 'Your email',       example: 'office@insurancerepairco.com.au' },
  ],
}

/** Placeholders a send type can't work without (the editor warns if one is missing). */
export const REQUIRED_TOKENS: Partial<Record<EmailSendType, string[]>> = {
  signing_request: ['signing_link'],
  signing_request_excess: ['signing_link'],
}

/** Email types listed in Settings → Email Templates, in display order. */
export const EMAIL_SEND_TYPES: { sendType: EmailSendType; label: string; description: string }[] = [
  {
    sendType: 'work_order',
    label: 'Work order',
    description: 'Sent to the trade by Send & Lock, with the work order PDF attached.',
  },
  {
    sendType: 'signing_request',
    label: 'Signature request',
    description: 'Sent to the homeowner with a secure link to sign the Scope of Works or Building Contract.',
  },
  {
    sendType: 'signing_request_excess',
    label: 'Signature request + excess invoice',
    description: 'Used instead of the signature request when an excess invoice is sent with it (invoice PDF attached).',
  },
  {
    sendType: 'signing_completed',
    label: 'Signed copy',
    description: 'Sent to the homeowner straight after they sign, with the signed PDF attached.',
  },
]

type WorkOrderVarsInput = {
  workOrder: { id: string; work_order_ref: string | null }
  job: { job_number: string; claim_number: string | null; insured_name: string | null; property_address: string | null }
  tenant: { name: string; trading_name: string | null }
  trade: { business_name: string | null; primary_contact: string | null } | null
  tradeLabel: string
}

/** Placeholder values for a work order email. */
export function workOrderTemplateVars({ workOrder, job, tenant, trade, tradeLabel }: WorkOrderVarsInput): Record<string, string | null> {
  return {
    trade_name:       trade?.business_name ?? '',
    trade_contact:    trade?.primary_contact?.trim() || trade?.business_name || 'there',
    trade_type:       tradeLabel || 'the',
    work_order_ref:   workOrder.work_order_ref || `WO-${workOrder.id.slice(0, 8).toUpperCase()}`,
    job_number:       job.job_number,
    claim_number:     job.claim_number,
    insured_name:     job.insured_name,
    property_address: job.property_address,
    company_name:     tenant.trading_name || tenant.name,
  }
}

type SigningVarsInput = {
  signerName: string
  documentName: string
  job: { job_number: string; claim_number: string | null; insured_name: string | null; property_address: string | null }
  tenant: { name: string; trading_name: string | null; contact_phone: string | null; contact_email: string | null }
  /** signing_request only */
  signingLink?: string
  expiryDate?: string
  /** signing_completed only */
  signedAt?: string
  /** signing_request_excess only */
  excessAmount?: string
  invoiceRef?: string
  excessDue?: string
}

/** Placeholder values for the signature request / signed copy emails. */
export function signingTemplateVars(input: SigningVarsInput): Record<string, string | null> {
  const phone = input.tenant.contact_phone?.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3') ?? null
  return {
    signer_name:      input.signerName,
    signer_first_name: input.signerName.trim().split(/\s+/)[0] || input.signerName,
    document_name:    input.documentName,
    property_address: input.job.property_address,
    job_number:       input.job.job_number,
    claim_number:     input.job.claim_number,
    insured_name:     input.job.insured_name,
    company_name:     input.tenant.trading_name || input.tenant.name,
    company_phone:    phone,
    company_email:    input.tenant.contact_email,
    ...(input.signingLink !== undefined ? { signing_link: input.signingLink } : {}),
    ...(input.expiryDate !== undefined ? { expiry_date: input.expiryDate } : {}),
    ...(input.signedAt !== undefined ? { signed_at: input.signedAt } : {}),
    ...(input.excessAmount !== undefined ? { excess_amount: input.excessAmount } : {}),
    ...(input.invoiceRef !== undefined ? { invoice_ref: input.invoiceRef } : {}),
    ...(input.excessDue !== undefined ? { excess_due: input.excessDue } : {}),
  }
}

/**
 * Replaces {token} placeholders. Unknown tokens are left as written so a typo
 * in a template is visible in the draft rather than silently blanked.
 */
export function renderTemplate(template: string, vars: Record<string, string | null | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (!(key in vars)) return match
    return vars[key] ?? ''
  })
}

/**
 * Picks the template for a send: the client-specific default for this
 * send_type if one exists, else the tenant-wide default, else built-in.
 */
export async function resolveEmailTemplate(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sendType: EmailSendType,
  clientId: string | null,
): Promise<ResolvedEmailTemplate> {
  const { data, error } = await supabase
    .from('email_templates')
    .select('id, name, client_id, subject_template, body_template, is_default, updated_at')
    .eq('tenant_id', tenantId)
    .eq('send_type', sendType)
  if (error) console.error(`[email-templates] lookup failed for ${sendType}:`, error)

  const rows = (data ?? []).filter(r => r.subject_template || r.body_template)
  const rank = (r: typeof rows[number]) =>
    (clientId && r.client_id === clientId ? 4 : r.client_id === null ? 2 : -100) + (r.is_default ? 1 : 0)
  const best = rows
    .filter(r => rank(r) >= 0)
    .sort((a, b) => rank(b) - rank(a) || (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))[0]

  const builtIn = BUILT_IN_TEMPLATES[sendType]
  if (!best) return { templateId: null, name: builtIn.name, subject: builtIn.subject, body: builtIn.body }
  return {
    templateId: best.id,
    name: best.name,
    subject: best.subject_template ?? builtIn.subject,
    body: best.body_template ?? builtIn.body,
  }
}
