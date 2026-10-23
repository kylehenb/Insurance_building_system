import type { Database } from '@/lib/supabase/database.types'
import { composeEmailBody, renderRichTemplate, type TemplateVars } from './rich-text'
import { composeStandardEmail } from './compose'
import { emailSignatureFor } from './signature'
import type { EmailSendType } from './templates'
import {
  actionButtonHtml,
  BRANDED_EMAIL_FONT_SIZE,
  renderBrandedEmailHtml,
  signingEmailFooterLines,
  signingEmailLogoUrl,
} from '@/lib/signing/email/html'

// The full email HTML for the template editor's preview: the same wrappers
// and signature the sends use (lib/signing/email/messages.ts for homeowner
// signing emails, lib/email/compose.ts for the rest). Client-safe.

type Tenant = Database['public']['Tables']['tenants']['Row']

const SIGNING_TYPES: EmailSendType[] = ['signing_request', 'signing_request_excess', 'signing_completed']

export function renderTemplatePreviewHtml(input: {
  sendType: EmailSendType
  body: string
  vars: TemplateVars
  tenant: Tenant
}): string {
  const { sendType, tenant } = input
  const rich = renderRichTemplate(input.body, input.vars)
  if (!SIGNING_TYPES.includes(sendType)) return composeStandardEmail(rich, tenant).html

  const link = input.vars.signing_link
  const { html: bodyHtml } = composeEmailBody(rich, {
    fontSize: BRANDED_EMAIL_FONT_SIZE,
    signature: emailSignatureFor(tenant),
    signatureFallback: tenant.trading_name || tenant.name,
    action: link ? { url: link, html: actionButtonHtml(link, 'Review and sign') } : undefined,
  })
  return renderBrandedEmailHtml({
    bodyHtml,
    logoUrl: signingEmailLogoUrl(tenant),
    companyName: tenant.trading_name || tenant.name,
    footerLines: signingEmailFooterLines(tenant),
  })
}
