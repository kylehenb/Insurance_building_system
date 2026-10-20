import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

// Email templates live in the email_templates table, one default per
// send_type, optionally overridden per client. Until a tenant has written
// one, the built-in defaults below are used so sends still work.

export type EmailSendType = 'work_order'

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
}

/** Email types listed in Settings → Email Templates, in display order. */
export const EMAIL_SEND_TYPES: { sendType: EmailSendType; label: string; description: string }[] = [
  {
    sendType: 'work_order',
    label: 'Work order',
    description: 'Sent to the trade by Send & Lock, with the work order PDF attached.',
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
