// Builds the document an email is shown in. Safe for client code.
//
// The email renders in an <iframe sandbox="allow-same-origin allow-popups
// allow-popups-to-escape-sandbox"> — no allow-scripts, so nothing in it runs.
// allow-same-origin only lets the page measure its height. The CSP below also
// blocks remote images (tracking pixels) until the reader asks for them.

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Plain-text email as HTML, with links clickable */
export function textToHtml(text: string): string {
  const escaped = escapeHtml(text)
  const linked = escaped.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, url => `<a href="${url}">${url}</a>`)
  return `<div style="white-space:pre-wrap;word-wrap:break-word">${linked}</div>`
}

/** Strips what the sandbox doesn't already neutralise */
export function cleanEmailHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    // A refresh would navigate the frame away from the email
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, '')
    // The email's own <base> would retarget our links
    .replace(/<base\b[^>]*>/gi, '')
}

/** True when the email loads images from the internet */
export function hasRemoteImages(html: string): boolean {
  return /<img\b[^>]*\ssrc\s*=\s*["']?https?:/i.test(html) || /url\(\s*["']?https?:/i.test(html)
}

export function emailDocument(body: string, opts: { showRemoteImages: boolean }): string {
  // Remote stylesheets and fonts are fetches too, so they wait with the images
  const remote = opts.showRemoteImages ? ' *' : ''
  const csp = `default-src 'none'; img-src 'self' data: blob:${remote}; style-src 'unsafe-inline'${remote}; font-src data:${remote}`
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<base target="_blank">
<style>
  html, body { margin: 0; padding: 0; }
  /* flow-root keeps the last paragraph's margin inside body, so the frame measures it */
  body { display: flow-root; font: 14px/1.5 -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #222; word-wrap: break-word; overflow-x: auto; }
  img { max-width: 100%; height: auto; }
  blockquote { margin: 0 0 0 .8ex; border-left: 1px solid #ccc; padding-left: 1ex; }
  pre { white-space: pre-wrap; }
</style></head><body>${cleanEmailHtml(body)}</body></html>`
}
