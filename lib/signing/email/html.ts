// Branded HTML wrapper for the homeowner signing emails: logo header, the
// email body (from composeEmailBody in lib/email/rich-text.ts, which also
// turns the signing-link line into actionButtonHtml), and a contact footer.
// Table layout and inline styles only, for old mail apps.

import { escapeHtml } from '@/lib/email/rich-text'
import { tenantAssetUrl } from '@/lib/email/signature'
import { appBaseUrl, SIGNER_CONTACT } from '@/lib/signing/config'

/** Normal text size for homeowner emails, in px (large for easy reading) */
export const BRANDED_EMAIL_FONT_SIZE = 18

export interface BrandedEmailInput {
  /** The email body as email-ready HTML */
  bodyHtml: string
  logoUrl: string | null
  companyName: string
  footerLines: string[]
}

interface BrandingTenant {
  name: string
  trading_name: string | null
  contact_email: string | null
  contact_phone: string | null
  logo_storage_path: string | null
}

export function signingEmailLogoUrl(tenant: BrandingTenant): string {
  return tenantAssetUrl(tenant.logo_storage_path) ?? `${appBaseUrl()}/logo-alt.png`
}

export function signingEmailFooterLines(tenant: BrandingTenant): string[] {
  const phone = tenant.contact_phone ? tenant.contact_phone.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3') : SIGNER_CONTACT.phone
  return [
    `${tenant.trading_name || tenant.name} · ${phone} · ${tenant.contact_email?.trim() || SIGNER_CONTACT.email}`,
    'You received this email because Insurance Repair Co is carrying out insurance repairs at your property.',
  ]
}

function linkify(escaped: string): string {
  return escaped.replace(/https?:\/\/[^\s<]+/g, url => `<a href="${url}" style="color:#1a4f8b;text-decoration:underline;">${url}</a>`)
}

/** The large button the signing-link line becomes. */
export function actionButtonHtml(url: string, label: string): string {
  const safeUrl = escapeHtml(url)
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px;">
  <tr><td align="center" bgcolor="#1a1a1a" style="border-radius:8px;">
    <a href="${safeUrl}" style="display:inline-block;padding:18px 32px;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
  </td></tr>
</table>
<p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#555555;">If the button doesn't work, copy this link into your browser:<br><a href="${safeUrl}" style="color:#1a4f8b;word-break:break-all;">${safeUrl}</a></p>`
}

export function renderBrandedEmailHtml(input: BrandedEmailInput): string {
  const logo = input.logoUrl
    ? `<img src="${escapeHtml(input.logoUrl)}" alt="${escapeHtml(input.companyName)}" height="48" style="display:block;height:48px;width:auto;border:0;">`
    : `<span style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#1a1a1a;">${escapeHtml(input.companyName)}</span>`

  const footer = input.footerLines
    .map(line => `<div>${linkify(escapeHtml(line))}</div>`)
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.companyName)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f2ee;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f2ee;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:10px;">
      <tr><td style="padding:24px 28px 16px;border-bottom:3px solid #c9a96e;">${logo}</td></tr>
      <tr><td style="padding:28px 28px 24px;">
${input.bodyHtml}
      </td></tr>
      <tr><td style="padding:16px 28px 24px;border-top:1px solid #e8e4e0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#666666;">${footer}</td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}
