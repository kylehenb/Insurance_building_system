import { composeEmailBody } from './rich-text'
import { emailSignatureFor, type SignatureTenant } from './signature'
import { renderStandardEmailHtml, STANDARD_EMAIL_FONT_SIZE } from './email-html'

/**
 * HTML and plain-text versions of a templated email to an insurer, adjuster
 * or trade (work orders, documents). `body` is the draft or Customise send
 * text: rich HTML, or plain text from the voice connector.
 */
export function composeStandardEmail(body: string, tenant: SignatureTenant): { html: string; text: string } {
  const companyName = tenant.trading_name || tenant.name
  const { html, text } = composeEmailBody(body, {
    fontSize: STANDARD_EMAIL_FONT_SIZE,
    signature: emailSignatureFor(tenant),
    signatureFallback: companyName,
  })
  return { html: renderStandardEmailHtml({ bodyHtml: html, title: companyName }), text }
}
