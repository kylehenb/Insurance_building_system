// The "Review and sign" button the {signing_link} line of a signing email
// becomes. Signing emails otherwise use the same plain email layout as every
// other templated email (lib/email/compose.ts): only what's in the template,
// then the signature. Table + bgcolor so Outlook shows the button's colour.

import { escapeHtml } from '@/lib/email/rich-text'

export const SIGNING_ACTION_LABEL = 'Review and sign'

export function actionButtonHtml(url: string, label: string): string {
  const safeUrl = escapeHtml(url)
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0;">
  <tr><td align="center" bgcolor="#1a1a1a" style="border-radius:6px;">
    <a href="${safeUrl}" style="display:inline-block;padding:12px 24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a>
  </td></tr>
</table>`
}
