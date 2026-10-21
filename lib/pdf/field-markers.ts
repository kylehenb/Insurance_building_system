// Invisible field markers for HTML documents rendered to PDF.
//
// A marker is a link with a special href, sized to the blank it covers.
// Chrome writes each link into the PDF as an annotation holding the page and
// rectangle it landed on, so code reading the PDF (lib/signing/pdf/
// locate-fields.ts) can find the blank exactly, wherever the content flowed.
// The href never resolves (.invalid is a reserved TLD) and the renderer blocks
// all network requests anyway.

export const FIELD_MARKER_PREFIX = 'https://irc-sign.invalid/field/'

export function fieldMarkerHref(name: string): string {
  return `${FIELD_MARKER_PREFIX}${encodeURIComponent(name)}`
}

/**
 * A marker filling its (position: relative) parent. Renders nothing visible.
 */
export function fieldMarkerHtml(name: string): string {
  return `<a href="${fieldMarkerHref(name)}" aria-hidden="true" tabindex="-1" style="position:absolute;left:0;top:0;right:0;bottom:0;display:block;color:transparent;text-decoration:none;font-size:1px;">&#8203;</a>`
}
