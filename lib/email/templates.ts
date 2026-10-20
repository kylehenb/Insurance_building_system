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

/** Tokens each send type supports, for substitution and for the template editor. */
export const TEMPLATE_TOKENS: Record<EmailSendType, string[]> = {
  work_order: [
    'trade_name', 'trade_contact', 'trade_type', 'work_order_ref',
    'job_number', 'claim_number', 'insured_name', 'property_address',
    'company_name',
  ],
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
