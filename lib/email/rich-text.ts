import { parseDocument } from 'htmlparser2'
import type { ChildNode, Element } from 'domhandler'

// Rich text for email templates and the email signature. Client-safe (the
// template editor's preview uses it too).
//
// Stored form: the small HTML subset the editor (components/email/
// RichTextEditor) produces — one <p> per line (an empty <p> is a blank line),
// <h2>/<h3> subheadings, bullet/numbered lists, bold/italic/underline/strike,
// links, and colour/size on <span>. Anything else is dropped or unwrapped.
// Templates written before rich text are plain text and are converted here.
//
// Sent form: the same structure with every style inline, Arial, no CSS
// classes, margins only — the subset Gmail, Outlook (Word engine), Apple Mail
// and the phone apps all render. A plain-text version always goes with it.

export interface EmailSignatureImage {
  url: string
  width: number
  height: number
  alt: string
}

export interface EmailSignature {
  /** Stored rich HTML (name, title, phone…). A {logo} line places the image;
   *  without one it goes at the end. */
  html: string
  /** Plain-text version of html */
  text: string
  image: EmailSignatureImage | null
}

export type TemplateVars = Record<string, string | null | undefined>

const FONT = 'Arial,Helvetica,sans-serif'
const TEXT_COLOR = '#1a1a1a'
const LINK_COLOR = '#1a4f8b'
const TOKEN_RE = /\{(\w+)\}/g
const URL_RE = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]']/g
const SIGNATURE_TOKEN = '{signature}'
/** A line of the signature that is exactly this is where the logo goes */
export const SIGNATURE_LOGO_TOKEN = '{logo}'

/** Colours offered in the editor (all readable on white). */
export const RICH_TEXT_COLORS: { label: string; value: string }[] = [
  { label: 'Black', value: '#1a1a1a' },
  { label: 'Grey', value: '#666666' },
  { label: 'Gold', value: '#a8843f' },
  { label: 'Navy', value: '#1a4f8b' },
  { label: 'Blue', value: '#1d6fd1' },
  { label: 'Green', value: '#1e7b34' },
  { label: 'Red', value: '#c0261c' },
  { label: 'Orange', value: '#c25e00' },
]

/** Text sizes offered in the editor, relative to the email's normal size. */
export const RICH_TEXT_SIZES: { label: string; value: string }[] = [
  { label: 'Small', value: '13px' },
  { label: 'Normal', value: '' },
  { label: 'Large', value: '20px' },
  { label: 'Extra large', value: '24px' },
]

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** True if a template body is stored rich HTML rather than older plain text. */
export function isRichText(body: string): boolean {
  return /^\s*<(p|h[1-6]|ul|ol|li|div|span|strong|b|em|i|u|s|a|br)\b/i.test(body)
}

/** Plain text → stored form: one paragraph per line, blank lines kept. */
export function plainTextToRichHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n')
  return lines.map(line => (line.trim() ? `<p>${escapeHtml(line)}</p>` : '<p></p>')).join('')
}

/** Any template body (rich or plain) → cleaned stored form. */
export function toRichHtml(body: string): string {
  return isRichText(body) ? walk(body, {}) : plainTextToRichHtml(body)
}

/**
 * Fills placeholders in a template body, giving cleaned rich HTML. Values are
 * escaped. Unknown placeholders stay as written, and {signature} is kept for
 * the send to fill in (it can't be edited as text).
 */
export function renderRichTemplate(body: string, vars: TemplateVars): string {
  const rest = Object.fromEntries(Object.entries(vars).filter(([key]) => key !== 'signature'))
  return walk(toRichHtml(body), { vars: rest })
}

/** Plain-text version of rich HTML (placeholders left as they are). */
export function richToText(html: string): string {
  const doc = parseDocument(toRichHtml(html))
  const lines: string[] = []
  for (const node of doc.children) blockToText(node, lines)
  return lines.join('\n').replace(/[ \t]+$/gm, '').replace(/\s+$/, '')
}

export interface ComposeEmailOptions {
  /** Normal text size in px (18 for homeowner emails, 15 for the rest) */
  fontSize: number
  signature: EmailSignature | null
  /** What {signature} becomes when no signature is set up */
  signatureFallback: string
  /** A line that is exactly this URL is shown as `html` (a big button) */
  action?: { url: string; html: string }
  /** The logo for a {logo} line in the body itself — a signature written into the email in the composer */
  logo?: EmailSignatureImage | null
}

/**
 * The HTML and plain-text versions of an email body (placeholders already
 * filled, except {signature}). The signature goes where {signature} is, or
 * at the end if the body doesn't have it.
 */
export function composeEmailBody(body: string, options: ComposeEmailOptions): { html: string; text: string } {
  let rich = toRichHtml(body)
  const { signature } = options
  if (signature && !richToText(rich).includes(SIGNATURE_TOKEN)) rich += `<p></p><p>${SIGNATURE_TOKEN}</p>`

  const signatureText = signature ? signature.text : options.signatureFallback
  const html = walk(rich, {
    vars: { signature: signatureText },
    email: {
      fontSize: options.fontSize,
      blockOverride: (lineText, rawText) => {
        if (signature && rawText === SIGNATURE_TOKEN) return signatureHtml(signature, options.fontSize)
        if (rawText === SIGNATURE_LOGO_TOKEN) return options.logo ? logoHtml(options.logo) : ''
        if (options.action && lineText === options.action.url) return options.action.html
        return null
      },
    },
  })
  const text = richToText(rich).split('\n').filter(line => line.trim() !== SIGNATURE_LOGO_TOKEN).join('\n')
    .split(SIGNATURE_TOKEN).join(signatureText)
  return { html, text }
}

/** The signature's text is a little smaller than the email's */
const signatureFontSize = (fontSize: number) => Math.max(13, fontSize - 2)

/** The signature's logo as email HTML */
function logoHtml(image: EmailSignatureImage): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0;"><tr><td>` +
    `<img src="${escapeHtml(image.url)}" width="${image.width}" height="${image.height}" alt="${escapeHtml(image.alt)}" ` +
    `style="display:block;width:${image.width}px;height:${image.height}px;max-width:100%;border:0;outline:none;text-decoration:none;">` +
    `</td></tr></table>`
}

/**
 * The signature as text to write into an email (the composer, as Gmail
 * does): its lines at the signature's smaller size, the logo as a {logo}
 * line (where it's placed, else at the end; none without an image) — which
 * composeEmailBody's `logo` turns back into the image when it's sent.
 */
export function signatureForEditor(signature: EmailSignature, fontSize: number): string {
  const size = `${signatureFontSize(fontSize)}px`
  const logoLine = `<p>${SIGNATURE_LOGO_TOKEN}</p>`
  let html = toRichHtml(signature.html)
  if (!signature.image) html = html.split(logoLine).join('')
  else if (!html.includes(logoLine)) html += logoLine
  return html.replace(/<p([^>]*)>([\s\S]*?)<\/p>/g, (whole, attrs: string, inner: string) =>
    !inner || inner === SIGNATURE_LOGO_TOKEN ? whole : `<p${attrs}><span style="font-size: ${size}">${inner}</span></p>`)
}

const BLOCK_RE = /<(p|h2|h3|ul|ol)\b[^>]*>[\s\S]*?<\/\1>/g
const blockText = (html: string) => richToText(html).trim()

/**
 * The email with the signature (signatureForEditor) taken off the end of its
 * text, and the blank lines before it — matched by its words, so a change of
 * formatting still matches. Null when the end isn't the signature (it's been
 * changed, or isn't there).
 */
export function withoutSignature(body: string, signatureText: string): string | null {
  const html = toRichHtml(body)
  const blocks = [...html.matchAll(BLOCK_RE)]
  const sig = [...toRichHtml(signatureText).matchAll(BLOCK_RE)].map(m => blockText(m[0])).filter(Boolean)
  let end = blocks.length
  while (end > 0 && !blockText(blocks[end - 1][0])) end--
  if (!sig.length || end < sig.length) return null
  for (let i = 0; i < sig.length; i++) {
    if (blockText(blocks[end - sig.length + i][0]) !== sig[i]) return null
  }
  let start = end - sig.length
  while (start > 0 && !blockText(blocks[start - 1][0])) start--
  return start === 0 ? '' : html.slice(0, blocks[start].index)
}

/** The signature as email HTML: its text, with the logo on its {logo} line (or at the end). */
export function signatureHtml(signature: EmailSignature, fontSize: number): string {
  const size = signatureFontSize(fontSize)
  const img = signature.image ? logoHtml(signature.image) : ''
  let placed = false
  const text = signature.html
    ? walk(signature.html, {
        email: {
          fontSize: size,
          blockOverride: (_line, raw) => {
            if (raw !== SIGNATURE_LOGO_TOKEN) return null
            if (placed) return ''
            placed = true
            return img
          },
        },
      })
    : ''
  return placed ? text : text + img
}

// ── The walker ─────────────────────────────────────────────────────────────

interface EmailMode {
  fontSize: number
  /** Replaces a whole line with HTML, or null to leave it. Gets the line's
   *  text with placeholders filled, and as written. */
  blockOverride?: (lineText: string, rawText: string) => string | null
}

interface WalkOptions {
  vars?: TemplateVars
  /** Set: inline styles for sending. Unset: the cleaned stored form. */
  email?: EmailMode
}

const BLOCK_TAGS: Record<string, 'p' | 'h2' | 'h3' | 'ul' | 'ol'> = {
  p: 'p', div: 'p', h1: 'h2', h2: 'h2', h3: 'h3', h4: 'h3', h5: 'h3', h6: 'h3', ul: 'ul', ol: 'ol',
}
const INLINE_TAGS: Record<string, 'strong' | 'em' | 'u' | 's' | 'a' | 'span'> = {
  strong: 'strong', b: 'strong', em: 'em', i: 'em', u: 'u', s: 's', strike: 's', del: 's', a: 'a', span: 'span',
}
const DROP_TAGS = new Set(['script', 'style', 'head', 'title', 'template', 'iframe', 'object', 'embed', 'svg', 'math', 'noscript', 'img', 'video', 'audio', 'form', 'input', 'button', 'select', 'textarea'])

function isElement(node: ChildNode): node is Element {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style'
}

function walk(html: string, options: WalkOptions): string {
  const doc = parseDocument(html)
  const out: string[] = []
  let pendingInline: ChildNode[] = []
  const flushInline = () => {
    if (pendingInline.length === 0) return
    const nodes = pendingInline
    pendingInline = []
    // Loose text/inline at the top level becomes its own line
    if (nodes.every(n => n.type === 'text' && !n.data.trim())) return
    out.push(renderBlock('p', null, nodes, options))
  }
  const visitTop = (nodes: ChildNode[]) => {
    for (const node of nodes) {
      if (isElement(node)) {
        const name = node.name.toLowerCase()
        if (DROP_TAGS.has(name)) continue
        const block = BLOCK_TAGS[name]
        if (block) {
          flushInline()
          // A <div> holding blocks is just a wrapper
          if (name === 'div' && node.children.some(c => isElement(c) && (BLOCK_TAGS[c.name.toLowerCase()] || c.name.toLowerCase() === 'li'))) {
            visitTop(node.children)
            continue
          }
          if (block === 'ul' || block === 'ol') out.push(renderList(block, node, options))
          else out.push(renderBlock(block, node, node.children, options))
          continue
        }
        if (name === 'li') {
          flushInline()
          out.push(renderList('ul', { ...node, children: [node] } as Element, options))
          continue
        }
        if (name === 'html' || name === 'body') { visitTop(node.children); continue }
      }
      if (node.type === 'text' || isElement(node)) pendingInline.push(node)
    }
    flushInline()
  }
  visitTop(doc.children)
  return out.join('')
}

function renderBlock(tag: 'p' | 'h2' | 'h3', el: Element | null, children: ChildNode[], options: WalkOptions): string {
  const align = el ? textAlign(el) : null
  const inner = renderInline(children, options, false)
  const { email } = options
  if (!email) {
    const style = align ? ` style="text-align: ${align}"` : ''
    return `<${tag}${style}>${inner}</${tag}>`
  }
  if (email.blockOverride) {
    const override = email.blockOverride(inlineText(children, options.vars).trim(), inlineText(children, undefined).trim())
    if (override !== null) return override
  }
  const size = tag === 'h2' ? Math.round(email.fontSize * 1.45) : tag === 'h3' ? Math.round(email.fontSize * 1.2) : email.fontSize
  const weight = tag === 'p' ? '' : 'font-weight:bold;'
  const lineHeight = tag === 'p' ? 1.5 : 1.3
  const style = `margin:0;font-family:${FONT};font-size:${size}px;line-height:${lineHeight};${weight}color:${TEXT_COLOR};${align ? `text-align:${align};` : ''}`
  return `<${tag} style="${style}">${inner || '&nbsp;'}</${tag}>`
}

function renderList(tag: 'ul' | 'ol', el: Element, options: WalkOptions): string {
  const items = el.children.filter((c): c is Element => isElement(c) && c.name.toLowerCase() === 'li')
  const { email } = options
  const renderItem = (li: Element): string => {
    // The editor wraps each item's text in <p>; a list item is one line here
    const parts: string[] = []
    let inline: ChildNode[] = []
    const flush = () => { if (inline.length) parts.push(renderInline(inline, options, false)); inline = [] }
    for (const child of li.children) {
      if (isElement(child) && BLOCK_TAGS[child.name.toLowerCase()] && !['ul', 'ol'].includes(child.name.toLowerCase())) {
        flush()
        parts.push(renderInline(child.children, options, false))
      } else if (isElement(child) && ['ul', 'ol'].includes(child.name.toLowerCase())) {
        flush() // nested lists are flattened into the item
        for (const sub of child.children) if (isElement(sub)) parts.push(renderInline(sub.children, options, false))
      } else inline.push(child)
    }
    flush()
    const content = parts.filter(Boolean).join('<br>')
    if (!email) return `<li><p>${content}</p></li>`
    return `<li style="margin:0;font-family:${FONT};font-size:${email.fontSize}px;line-height:1.5;color:${TEXT_COLOR};">${content || '&nbsp;'}</li>`
  }
  const inner = items.map(renderItem).join('')
  if (!email) return `<${tag}>${inner}</${tag}>`
  return `<${tag} style="margin:0 0 0 28px;padding:0;font-family:${FONT};font-size:${email.fontSize}px;line-height:1.5;color:${TEXT_COLOR};">${inner}</${tag}>`
}

function renderInline(nodes: ChildNode[], options: WalkOptions, insideLink: boolean): string {
  let out = ''
  for (const node of nodes) {
    if (node.type === 'text') {
      const filled = fillTokens(node.data, options.vars)
      if (!options.email) { out += escapeHtml(filled); continue }
      // A filled-in value over several lines (the signature's text) keeps its lines
      out += filled.split('\n').map(part => (insideLink ? escapeHtml(part) : linkify(part))).join('<br>')
      continue
    }
    if (!isElement(node)) continue
    const name = node.name.toLowerCase()
    if (DROP_TAGS.has(name)) continue
    if (name === 'br') { out += '<br>'; continue }
    const tag = INLINE_TAGS[name]
    if (!tag) { out += renderInline(node.children, options, insideLink); continue } // unknown: keep the text
    if (tag === 'a') {
      const href = safeHref(fillTokens(node.attribs.href ?? '', options.vars), !options.email)
      const inner = renderInline(node.children, options, true)
      if (!href || insideLink) { out += inner; continue }
      const style = options.email ? ` style="color:${LINK_COLOR};text-decoration:underline;"` : ''
      out += `<a href="${escapeHtml(href)}"${style}>${inner}</a>`
      continue
    }
    if (tag === 'span') {
      const style = spanStyle(node)
      const inner = renderInline(node.children, options, insideLink)
      out += style ? `<span style="${style}">${inner}</span>` : inner
      continue
    }
    out += `<${tag}>${renderInline(node.children, options, insideLink)}</${tag}>`
  }
  return out
}

/** A line's text with placeholders filled, for matching a whole line. */
function inlineText(nodes: ChildNode[], vars: TemplateVars | undefined): string {
  let out = ''
  for (const node of nodes) {
    if (node.type === 'text') out += fillTokens(node.data, vars)
    else if (isElement(node) && !DROP_TAGS.has(node.name.toLowerCase())) out += node.name.toLowerCase() === 'br' ? '\n' : inlineText(node.children, vars)
  }
  return out
}

function fillTokens(text: string, vars: TemplateVars | undefined): string {
  if (!vars) return text
  return text.replace(TOKEN_RE, (match, key: string) => (key in vars ? vars[key] ?? '' : match))
}

function linkify(text: string): string {
  let out = ''
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    out += escapeHtml(text.slice(last, m.index))
    const url = escapeHtml(m[0])
    out += `<a href="${url}" style="color:${LINK_COLOR};text-decoration:underline;word-break:break-all;">${url}</a>`
    last = m.index + m[0].length
  }
  return out + escapeHtml(text.slice(last))
}

function safeHref(href: string, allowToken: boolean): string | null {
  const value = href.trim()
  if (/^(https?:\/\/|mailto:|tel:)/i.test(value)) return value
  if (allowToken && /^\{\w+\}$/.test(value)) return value
  return null
}

function parseStyle(el: Element): Map<string, string> {
  const map = new Map<string, string>()
  for (const decl of (el.attribs.style ?? '').split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    map.set(decl.slice(0, i).trim().toLowerCase(), decl.slice(i + 1).trim().toLowerCase())
  }
  return map
}

function textAlign(el: Element): 'center' | 'right' | null {
  const value = parseStyle(el).get('text-align') ?? el.attribs.align?.toLowerCase()
  return value === 'center' || value === 'right' ? value : null
}

function spanStyle(el: Element): string {
  const style = parseStyle(el)
  const parts: string[] = []
  const color = normaliseColor(style.get('color') ?? el.attribs.color)
  if (color) parts.push(`color: ${color}`)
  const size = normaliseFontSize(style.get('font-size'))
  if (size) parts.push(`font-size: ${size}`)
  return parts.join('; ')
}

function normaliseColor(value: string | undefined): string | null {
  if (!value) return null
  const v = value.trim().toLowerCase()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  if (/^#[0-9a-f]{6}$/.test(v)) return v
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/.exec(v)
  if (rgb) return `#${rgb.slice(1, 4).map(n => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')}`
  return null
}

function normaliseFontSize(value: string | undefined): string | null {
  if (!value) return null
  const m = /^(\d+(?:\.\d+)?)(px|pt)$/.exec(value.trim())
  if (!m) return null
  const px = m[2] === 'pt' ? Number(m[1]) * 4 / 3 : Number(m[1])
  return `${Math.round(Math.min(40, Math.max(10, px)))}px`
}

// ── Plain text ─────────────────────────────────────────────────────────────

function blockToText(node: ChildNode, lines: string[]): void {
  if (node.type === 'text') { if (node.data.trim()) lines.push(node.data.trim()); return }
  if (!isElement(node)) return
  const name = node.name.toLowerCase()
  if (name === 'ul' || name === 'ol') {
    let n = 0
    for (const li of node.children) {
      if (!isElement(li) || li.name.toLowerCase() !== 'li') continue
      n += 1
      const text = li.children.map(c => (isElement(c) && c.name.toLowerCase() === 'p' ? inlineToText(c.children) : inlineToText([c]))).filter(Boolean).join(' ')
      lines.push(`${name === 'ol' ? `${n}.` : '•'} ${text}`)
    }
    return
  }
  lines.push(...inlineToText(node.children).split('\n'))
}

function inlineToText(nodes: ChildNode[]): string {
  let out = ''
  for (const node of nodes) {
    if (node.type === 'text') { out += node.data; continue }
    if (!isElement(node)) continue
    const name = node.name.toLowerCase()
    if (name === 'br') { out += '\n'; continue }
    const inner = inlineToText(node.children)
    if (name === 'a') {
      const href = node.attribs.href ?? ''
      const shown = href.replace(/^mailto:|^tel:/i, '')
      out += !href || inner.trim() === shown || inner.trim() === href ? inner : `${inner} (${shown})`
      continue
    }
    out += inner
  }
  return out
}
