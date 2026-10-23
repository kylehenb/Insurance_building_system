import { escapeHtml } from './rich-text'

// The HTML wrapper for every templated email: a plain, left-aligned email
// like one written in Gmail, so it reads as a normal message — only what's in
// the template and the signature. No width cap or padding: text fills the
// reader's window and wraps only where it runs out of room, and lines break
// only where the template has a line break. Table layout and inline styles only.

/** Normal text size for these emails, in px */
export const STANDARD_EMAIL_FONT_SIZE = 15

export function renderStandardEmailHtml(input: { bodyHtml: string; title: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
  <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:${STANDARD_EMAIL_FONT_SIZE}px;line-height:1.5;color:#1a1a1a;">
${input.bodyHtml}
  </td></tr>
</table>
</body>
</html>`
}
