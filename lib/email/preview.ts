import type { Database } from '@/lib/supabase/database.types'
import { renderRichTemplate, type TemplateVars } from './rich-text'
import { composeStandardEmail } from './compose'
import type { EmailSendType } from './templates'
import { actionButtonHtml, SIGNING_ACTION_LABEL } from '@/lib/signing/email/html'

// The full email HTML for the template editor's preview: the same layout and
// signature the sends use (lib/email/compose.ts), with the signing button
// where the {signing_link} line is. Client-safe.

type Tenant = Database['public']['Tables']['tenants']['Row']

export function renderTemplatePreviewHtml(input: {
  sendType: EmailSendType
  body: string
  vars: TemplateVars
  tenant: Tenant
}): string {
  const link = input.vars.signing_link
  const action = link ? { url: link, html: actionButtonHtml(link, SIGNING_ACTION_LABEL) } : undefined
  return composeStandardEmail(renderRichTemplate(input.body, input.vars), input.tenant, action).html
}
