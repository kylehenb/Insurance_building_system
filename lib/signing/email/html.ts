// Branded HTML version of a plain-text email template.
//
// The office edits plain text in Settings → Email Templates. Here each blank-
// line-separated paragraph becomes a <p>; a paragraph that is exactly the
// action link becomes a large button; other URLs become links. Table layout
// and inline styles only, for old mail apps.

export interface BrandedEmailInput {
  /** The rendered plain-text body (placeholders already filled) */
  text: string
  /** If a paragraph is exactly this URL, it is shown as a button */
  actionUrl?: string
  actionLabel?: string
  logoUrl: string | null
  companyName: string
  footerLines: string[]
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function linkify(escaped: string): string {
  return escaped.replace(/https?:\/\/[^\s<]+/g, url => `<a href="${url}" style="color:#1a4f8b;text-decoration:underline;">${url}</a>`)
}

function button(url: string, label: string): string {
  const safeUrl = escapeHtml(url)
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
  <tr><td align="center" bgcolor="#1a1a1a" style="border-radius:8px;">
    <a href="${safeUrl}" style="display:inline-block;padding:18px 32px;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
  </td></tr>
</table>
<p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#555555;">If the button doesn't work, copy this link into your browser:<br><a href="${safeUrl}" style="color:#1a4f8b;word-break:break-all;">${safeUrl}</a></p>`
}

export function renderBrandedEmailHtml(input: BrandedEmailInput): string {
  const paragraphs = input.text.replace(/\r\n/g, '\n').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)

  const bodyHtml = paragraphs.map(p => {
    if (input.actionUrl && p === input.actionUrl) return button(input.actionUrl, input.actionLabel ?? 'Open')
    const html = p.split('\n').map(line => linkify(escapeHtml(line))).join('<br>')
    return `<p style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.55;color:#1a1a1a;">${html}</p>`
  }).join('\n')

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
      <tr><td style="padding:28px 28px 8px;">
${bodyHtml}
      </td></tr>
      <tr><td style="padding:16px 28px 24px;border-top:1px solid #e8e4e0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#666666;">${footer}</td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}
