import { createHash } from 'node:crypto'
import { CONSENT_TEXT, SIGNER_CONTACT } from '@/lib/signing/config'
import { formatPerthDateTime, formatSigningDate } from '@/lib/signing/format'
import type { SignerExcessInvoice, SignerFieldView, SignerView } from '@/lib/signing/in-house/signer'
import { DEFAULT_SIGNATURE_STYLE, SIGNATURE_STYLES } from '@/lib/signing/signature-styles'
import type { DisplayBlock, PdfRect, SignerCapacity } from '@/lib/signing/types'
import { SIGNER_SCRIPT } from './script'
import { SIGNER_CSS } from './styles'

// The signer page as a complete HTML document. It is deliberately not a
// React page: no framework runtime, no hydration, no Tailwind — just HTML,
// plain CSS and one small ES5 script — so it loads fast and works on older
// iPhones and Android phones. Every value from the database is escaped.

export interface SignerPageOptions {
  token: string
  done?: string | null
  error?: string | null
}

const ERROR_MESSAGES: Record<string, string> = {
  name: 'Please type your full name to sign.',
  drawn: 'We couldn’t read your drawn signature. Please draw it again, or type your name instead.',
  busy: 'This document is already being signed. Please wait a moment and refresh the page.',
  rate: 'Too many attempts. Please wait a few minutes and try again.',
  failed: 'Sorry, something went wrong while signing. Nothing was signed — please try again.',
}

const DEFAULT_COMPANY = 'Insurance Repair Co'

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** CSS font-family for a signature style, served from /api/sign/fonts/[style]. */
export function signatureFontFamily(styleKey: string): string {
  return `'sg-${styleKey}', cursive`
}

const FONT_FACES = SIGNATURE_STYLES.map(s =>
  `@font-face { font-family: 'sg-${s.key}'; src: url('/api/sign/fonts/${s.key}') format('truetype'); font-display: swap; }`,
).join('\n')

/** sha256 hash of the inline script, for the Content-Security-Policy. */
export const SIGNER_SCRIPT_HASH = `sha256-${createHash('sha256').update(SIGNER_SCRIPT).digest('base64')}`

/** Strict CSP: only this page's own inline script, styles, fonts and images. */
export const SIGNER_PAGE_CSP = [
  "default-src 'none'",
  `script-src '${SIGNER_SCRIPT_HASH}'`,
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ')

function contactBox(intro = 'Questions? We’re happy to help.'): string {
  return `<div class="sg-contact">
  <p style="margin:0 0 4px">${esc(intro)}</p>
  <div>Call <a href="${SIGNER_CONTACT.phoneHref}">${esc(SIGNER_CONTACT.phone)}</a></div>
  <div>Email <a href="mailto:${esc(SIGNER_CONTACT.email)}">${esc(SIGNER_CONTACT.email)}</a></div>
</div>`
}

function statusScreen(icon: string, title: string, body: string): string {
  return `<main class="sg-wrap sg-status">
  <div class="sg-status-icon" aria-hidden="true">${icon}</div>
  <h1>${esc(title)}</h1>
  ${body}
</main>`
}

function documentFor(view: SignerView): string {
  return view.documentName
    ? `<strong>${esc(view.documentName)}</strong>${view.propertyAddress ? ` for ${esc(view.propertyAddress)}` : ''}`
    : 'document'
}

const money = (v: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)

/**
 * The excess invoice sent with the document. Deliberately neutral: payments
 * are reconciled in batches, so the page never says an invoice is unpaid —
 * only "paid" once the office has recorded it.
 */
function excessInvoiceCard(inv: SignerExcessInvoice, downloadUrl: string, afterSigning: boolean): string {
  const title = `Excess invoice${inv.ref ? ` ${esc(inv.ref)}` : ''}`
  if (inv.paidDate) {
    return `<section class="sg-card sg-invoice" aria-label="${title}">
  <p class="sg-kicker">Your excess</p>
  <h2>${title}</h2>
  <p>${esc(money(inv.amountIncGst))} — paid ${esc(formatSigningDate(inv.paidDate))}. Thank you.</p>
  <a href="${esc(downloadUrl)}" class="sg-btn sg-btn-secondary" target="_blank" rel="noopener">View the invoice (PDF)</a>
</section>`
  }
  const bank = inv.bank
  const rows = [
    bank?.accountName ? ['Account name', bank.accountName] : null,
    bank?.bankName ? ['Bank', bank.bankName] : null,
    bank?.bsb ? ['BSB', bank.bsb] : null,
    bank?.accountNumber ? ['Account number', bank.accountNumber] : null,
    inv.ref ? ['Reference', inv.ref] : null,
  ].filter((r): r is string[] => !!r)
  return `<section class="sg-card sg-invoice" aria-label="${title}">
  <p class="sg-kicker">Your excess</p>
  <h2>${title}</h2>
  <p>${afterSigning ? 'As a reminder, your' : 'Your'} insurance excess of <strong>${esc(money(inv.amountIncGst))}</strong> is payable ${esc(inv.dueText)}. This is separate from signing — the invoice is also attached to our email.</p>
  ${rows.length ? `<p class="sg-label">Pay by bank transfer</p>
  <dl class="sg-details">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
  <a href="${esc(downloadUrl)}" class="sg-btn sg-btn-secondary" target="_blank" rel="noopener">View the invoice (PDF)</a>
  <p class="sg-foot">Already paid? Thank you — there’s nothing more to do.</p>
</section>`
}

function signatureField(block: Extract<DisplayBlock, { type: 'signature' }>, index: number, total: number): string {
  return `<section class="sg-field" id="field-${index + 1}" data-field-id="${esc(block.fieldId)}" data-label="${esc(block.label)}" aria-label="Signature ${index + 1} of ${total}: ${esc(block.label)}">
  <div class="sg-step">Signature ${index + 1} of ${total} · ${esc(block.label)}</div>
  <p>${esc(block.context)}</p>
  <button type="button" class="sg-sign-box sg-js-only" aria-label="${esc(block.label)}: tap to sign">
    <span class="sg-sign-placeholder">✍️ Tap here to sign</span>
    <span class="sg-sign-preview"></span>
  </button>
  <div class="sg-sign-done">✓ Signed. Tap the box above to change your signature.</div>
  <p class="sg-nojs-note">Your signature will be added here when you tap Finish at the bottom of the page.</p>
</section>`
}

export function renderDocumentBlocks(blocks: DisplayBlock[]): string {
  const total = blocks.filter(b => b.type === 'signature').length
  let sigIndex = 0
  const html = blocks.map(block => {
    switch (block.type) {
      case 'heading':
        return `<h2>${esc(block.text)}</h2>`
      case 'paragraph':
        return `<p${block.emphasis ? ' class="sg-callout"' : ''}>${esc(block.text)}</p>`
      case 'details':
        return `<dl class="sg-details">${block.rows.map(r => `<div><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`).join('')}</dl>`
      case 'list': {
        const tag = block.ordered ? 'ol' : 'ul'
        return `<${tag} class="sg-list">${block.items.map(i => `<li>${esc(i)}</li>`).join('')}</${tag}>`
      }
      case 'scope': {
        let n = 0
        return `<div>${block.rooms.map(room => `<div class="sg-room"><h3>${esc(room.room)}</h3><ol>${room.items.map(item => {
          n++
          return `<li value="${n}">${esc(item.description)}${item.qty ? `<span class="sg-qty">Quantity: ${esc(item.qty)}</span>` : ''}</li>`
        }).join('')}</ol></div>`).join('')}</div>`
      }
      case 'signature':
        return signatureField(block, sigIndex++, total)
      default:
        return ''
    }
  })
  return `<article class="sg-doc">${html.join('\n')}</article>`
}

// ── The real document pages ─────────────────────────────────────────────────
// Images of the exact PDF being signed, with each signature box placed where
// the signature will be stamped (positions in % of the page, so they scale
// with the image). Date and printed name previews appear in their blanks
// once a box is signed.

type PagesBlock = Extract<DisplayBlock, { type: 'pages' }>
type PageSize = PagesBlock['pages'][number]

function pagesBlockOf(view: SignerView): PagesBlock | null {
  return view.display.find((b): b is PagesBlock => b.type === 'pages') ?? null
}

const pct = (v: number) => `${Math.round(v * 100000) / 1000}%`

function rectStyle(rect: PdfRect, page: PageSize): string {
  const top = (page.heightPt - rect.y - rect.height) / page.heightPt
  return `left:${pct(rect.x / page.widthPt)};top:${pct(top)};width:${pct(rect.width / page.widthPt)};height:${pct(rect.height / page.heightPt)}`
}

function pageOverlays(fields: SignerFieldView[], pageIndex: number, page: PageSize): string {
  const out: string[] = []
  fields.forEach((field, i) => {
    const fills: [PdfRect | null | undefined, string][] = [[field.date, 'date'], [field.name, 'name'], [field.representative, 'representative']]
    for (const [rect, kind] of fills) {
      if (rect && rect.page === pageIndex) {
        out.push(`<span class="sg-fill" data-fill="${kind}" data-for="${esc(field.id)}" style="${rectStyle(rect, page)}" aria-hidden="true"></span>`)
      }
    }
    if (field.signature && field.signature.page === pageIndex) {
      out.push(`<div class="sg-field sg-onpage" id="field-${i + 1}" data-field-id="${esc(field.id)}" data-label="${esc(field.label)}" style="${rectStyle(field.signature, page)}">
        <span class="sg-flag sg-js-only" aria-hidden="true">✍️ Sign here${fields.length > 1 ? ` (${i + 1} of ${fields.length})` : ''}</span>
        <button type="button" class="sg-sign-box sg-js-only" aria-label="Signature ${i + 1} of ${fields.length}, ${esc(field.label)}: tap to sign">
          <span class="sg-sign-placeholder">Tap to sign</span>
          <span class="sg-sign-preview"></span>
        </button>
      </div>`)
    }
  })
  return out.join('\n')
}

function largePrintBlocks(blocks: DisplayBlock[]): DisplayBlock[] {
  return blocks
    .filter(b => b.type !== 'pages')
    .map(b => (b.type === 'signature'
      ? { type: 'paragraph' as const, text: `✍️ ${b.label}: you sign this on the document pages above.`, emphasis: true }
      : b))
}

function documentPages(view: SignerView, pages: PagesBlock, base: string): string {
  const total = pages.pages.length
  const name = view.documentName ?? 'document'
  const figures = pages.pages.map((page, i) => {
    const src = `${base}/page/${i + 1}`
    return `<figure class="sg-page" id="page-${i + 1}">
    <figcaption>Page ${i + 1} of ${total}</figcaption>
    <div class="sg-sheet" style="padding-top:${pct(page.heightPt / page.widthPt)}">
      <a href="${esc(src)}" target="_blank" rel="noopener" class="sg-sheet-link" aria-label="Open page ${i + 1} full size"><img src="${esc(src)}" alt="Page ${i + 1} of the ${esc(name)}"${i > 1 ? ' loading="lazy"' : ''}></a>
      ${pageOverlays(view.fields, i, page)}
    </div>
  </figure>`
  }).join('\n')
  return `<section class="sg-pages" aria-label="The ${esc(name)}">
  ${figures}
  <p class="sg-nojs-note sg-wrap">Your signature will be added in the boxes above when you tap Finish at the bottom of the page.</p>
</section>
<div class="sg-wrap">
  <p class="sg-zoom-tip">To zoom in, spread two fingers on a page, or tap a page to open it on its own.</p>
  <details class="sg-easy">
    <summary>Text too small? Read the same wording in large print</summary>
    ${renderDocumentBlocks(largePrintBlocks(view.display))}
  </details>
</div>`
}

function signatureForm(action: string, signerName: string, ownerName: string | null): string {
  const styles = SIGNATURE_STYLES.map(style => {
    const checked = style.key === DEFAULT_SIGNATURE_STYLE
    return `<label class="sg-style${checked ? ' is-checked' : ''}">
        <input type="radio" name="style" value="${esc(style.key)}"${checked ? ' checked' : ''} aria-label="${esc(style.label)}">
        <span class="sg-style-sample" style="font-family:${esc(signatureFontFamily(style.key))}">${esc(signerName || 'Your name')}</span>
      </label>`
  }).join('\n')

  return `<form id="sg-form" method="post" action="${esc(action)}" class="sg-card" novalidate>
  <section id="sg-adopt" class="sg-adopt" aria-labelledby="sg-adopt-title">
    <div class="sg-wrap">
      <div class="sg-sheet-head">
        <h2 id="sg-adopt-title">Your signature</h2>
        <button type="button" id="sg-adopt-close" class="sg-btn sg-btn-link sg-js-only">Close</button>
      </div>
      <label class="sg-label" for="sg-typed-name">Your full name</label>
      <input id="sg-typed-name" class="sg-input" name="typed_name" value="${esc(signerName)}" autocomplete="name" autocapitalize="words" maxlength="80">
      <fieldset class="sg-capacity">
        <legend class="sg-label">Who is signing?</legend>
        ${capacityOptions(ownerName)}
      </fieldset>
      <p class="sg-label" style="margin-top:18px">How would you like to sign?</p>
      <div class="sg-tabs sg-js-only" role="radiogroup" aria-label="How to sign">
        <label class="sg-tab"><input type="radio" name="method" value="typed" checked><span>Type my name</span></label>
        <label class="sg-tab"><input type="radio" name="method" value="drawn"><span>Draw</span></label>
      </div>
      <div class="sg-panel-type">
        <div class="sg-styles" role="radiogroup" aria-label="Signature style">
          <p class="sg-label">Choose a style</p>
          ${styles}
        </div>
      </div>
      <div class="sg-panel-draw">
        <p>Use your finger to sign in the box.</p>
        <div class="sg-draw-wrap">
          <canvas id="sg-canvas" aria-label="Signature drawing area"></canvas>
          <div class="sg-draw-line"></div>
          <div class="sg-draw-hint">Sign above the line</div>
        </div>
        <button type="button" id="sg-clear" class="sg-btn sg-btn-link">Clear and start again</button>
      </div>
      <input type="hidden" name="drawn_png" id="sg-drawn-png" value="">
      <div id="sg-adopt-error" class="sg-error" role="alert" style="display:none"></div>
      <button type="button" id="sg-adopt-btn" class="sg-btn sg-btn-primary sg-js-only" style="margin-top:18px">Use this signature</button>
    </div>
  </section>
  <div id="finish" class="sg-finish-inline">
    <p class="sg-consent">${esc(CONSENT_TEXT)}</p>
    <button type="submit" class="sg-btn sg-btn-primary">Finish</button>
  </div>
</form>`
}

function capacityOptions(ownerName: string | null): string {
  const options: { value: SignerCapacity; title: string; hint: string }[] = [
    { value: 'owner', title: 'I am the owner', hint: ownerName ? `Named on this document as ${ownerName}` : 'Named on this document' },
    { value: 'joint_owner', title: 'I am a joint owner', hint: 'For example a husband, wife or partner who also owns the property' },
    {
      value: 'authorised_person',
      title: 'I am signing for the owner',
      hint: `${ownerName ? `On behalf of ${ownerName}. ` : ''}By choosing this you confirm you have the owner’s authority to sign for them.`,
    },
  ]
  return options.map(o => `<label class="sg-choice${o.value === 'owner' ? ' is-checked' : ''}">
          <input type="radio" name="capacity" value="${o.value}"${o.value === 'owner' ? ' checked' : ''}>
          <span><strong>${esc(o.title)}</strong><span class="sg-choice-hint">${esc(o.hint)}</span></span>
        </label>`).join('\n        ')
}

function openFlow(view: SignerView, token: string, errorMessage: string | null, companyName: string): string {
  const base = `/api/sign/${encodeURIComponent(token)}`
  const firstName = view.signerName?.trim().split(/\s+/)[0] ?? ''
  const fieldCount = view.fields.length
  const fonts = Object.fromEntries(SIGNATURE_STYLES.map(s => [s.key, signatureFontFamily(s.key)]))

  const pages = pagesBlockOf(view)
  const documentView = pages && view.fields.every(f => f.signature)
    ? documentPages(view, pages, base)
    : `<div class="sg-wrap">${renderDocumentBlocks(view.display)}</div>`

  return `<div id="sg-root" data-view-url="${esc(`${base}/view`)}" data-fonts="${esc(JSON.stringify(fonts))}" data-has-error="${errorMessage ? '1' : '0'}" data-today="${esc(formatSigningDate(new Date()))}" data-owner="${esc(view.ownerName ?? '')}">
  <main>
  <div class="sg-wrap">
    ${errorMessage ? `<div class="sg-error" role="alert">${esc(errorMessage)}</div>` : ''}
    <section class="sg-card" aria-labelledby="sg-title">
      <p class="sg-kicker">From ${esc(companyName)}</p>
      <h1 id="sg-title">Please sign your ${esc(view.documentName)}</h1>
      <p>${firstName ? `Hi ${esc(firstName)}. ` : ''}This is for the repairs at <strong>${esc(view.propertyAddress ?? 'your property')}</strong>.</p>
      <ol class="sg-howto">
        <li>${pages ? 'Read the document below — these are the actual pages you are signing.' : 'Read the document below.'}</li>
        <li>Sign in ${fieldCount === 1 ? '1 place' : `${fieldCount} places`}.</li>
        <li>Tap <strong>Finish</strong>.</li>
      </ol>
      ${view.excessInvoice && !view.excessInvoice.paidDate ? `<p>Your excess invoice and how to pay it are at the bottom of this page.</p>` : ''}
      <a href="#field-1" class="sg-btn sg-btn-primary" data-sg-start="1">Start</a>
      <a href="${esc(`${base}/document`)}" class="sg-btn sg-btn-secondary" target="_blank" rel="noopener">View the full document (PDF)</a>
      ${view.expiresAt ? `<p class="sg-foot">This link works until ${esc(formatSigningDate(view.expiresAt))}.</p>` : ''}
    </section>
  </div>
  ${documentView}
  <div class="sg-wrap">
    ${signatureForm(`${base}/submit`, view.signerName ?? '', view.ownerName)}
    ${view.excessInvoice ? excessInvoiceCard(view.excessInvoice, `${base}/invoice`, false) : ''}
    ${contactBox()}
    <p class="sg-foot">Your signature is added to the document together with the date, time and a record of this device, so it can be checked later.</p>
  </div>
  </main>
  <div id="sg-bar" class="sg-bar" role="region" aria-label="Signing steps">
    <div class="sg-wrap">
      <div id="sg-bar-progress" class="sg-bar-progress" aria-live="polite"></div>
      <p class="sg-consent">${esc(CONSENT_TEXT)}</p>
      <button type="button" id="sg-bar-btn" class="sg-btn sg-btn-primary">Start</button>
    </div>
  </div>
  <div id="sg-overlay" class="sg-overlay" role="status" aria-live="assertive">
    <div class="sg-spinner"></div>
    Signing your document…<br><span style="font-weight:normal;font-size:19px">Please keep this page open.</span>
  </div>
</div>
<script>${SIGNER_SCRIPT}</script>`
}

function bodyFor(view: SignerView | 'rate_limited', options: SignerPageOptions): { companyName: string; body: string } {
  if (view === 'rate_limited') {
    return {
      companyName: DEFAULT_COMPANY,
      body: statusScreen('⏳', 'Please wait a moment',
        `<p>This page has been opened many times in a short while. Please wait a few minutes, then open the link again.</p>${contactBox()}`),
    }
  }

  const companyName = view.companyName ?? DEFAULT_COMPANY
  switch (view.state) {
    case 'not_found':
      return {
        companyName,
        body: statusScreen('🔗', 'This link isn’t working',
          `<p>The signing link may be incomplete, or it may have been replaced by a newer one. Please check your most recent email from us, or get in touch and we’ll send you a new link.</p>${contactBox()}`),
      }
    case 'expired':
      return {
        companyName,
        body: statusScreen('⌛', 'This signing link has expired',
          `<p>For your security, signing links only work for a limited time. Please contact us and we’ll send you a new one straight away.</p>
           ${view.documentName ? `<p>${documentFor(view)}</p>` : ''}
           ${contactBox('To get a new link:')}`),
      }
    case 'revoked':
      return {
        companyName,
        body: statusScreen('✋', 'This signing link is no longer active',
          `<p>We’ve cancelled this request, so there’s nothing for you to sign here. If you weren’t expecting this, please get in touch.</p>${contactBox()}`),
      }
    case 'signed':
      if (options.done === '1' && view.signedRecently) {
        return {
          companyName,
          body: statusScreen('✅', 'Thank you, you’ve signed',
            `<p>Your ${documentFor(view)} has been signed.</p>
             <p>We’ve emailed you a copy of the signed document. ${view.excessInvoice && !view.excessInvoice.paidDate ? 'The only other thing is your excess, below.' : 'There’s nothing else you need to do here — you can close this page.'}</p>
             ${view.signedAt ? `<p class="sg-foot">Signed ${esc(formatPerthDateTime(view.signedAt))}</p>` : ''}
             ${view.excessInvoice ? excessInvoiceCard(view.excessInvoice, `/api/sign/${encodeURIComponent(options.token)}/invoice`, true) : ''}
             ${contactBox()}`),
        }
      }
      return {
        companyName,
        body: statusScreen('✅', 'This document has already been signed',
          `<p>The ${documentFor(view)} was signed${view.signedAt ? ` on ${esc(formatSigningDate(view.signedAt))}` : ''}. A copy was emailed when it was signed.</p>
           <p>There’s nothing else to do. If you need another copy, please get in touch.</p>
           ${contactBox()}`),
      }
    case 'open': {
      const errorMessage = options.error ? ERROR_MESSAGES[options.error] ?? ERROR_MESSAGES.failed : null
      return { companyName, body: openFlow(view, options.token, errorMessage, companyName) }
    }
  }
}

export function renderSignerPage(view: SignerView | 'rate_limited', options: SignerPageOptions): string {
  const { companyName, body } = bodyFor(view, options)
  return documentShell(companyName, body)
}

/** Shown if loading the link fails unexpectedly (database or storage outage). */
export function renderSignerErrorPage(): string {
  return documentShell(DEFAULT_COMPANY, statusScreen('⚠️', 'Sorry, something went wrong',
    `<p>We couldn’t open your document just now. Please try again in a few minutes, or get in touch.</p>${contactBox()}`))
}

function documentShell(companyName: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#ffffff">
<meta name="format-detection" content="telephone=no">
<title>Sign your document — ${esc(companyName)}</title>
<style>
${FONT_FACES}
${SIGNER_CSS}
</style>
</head>
<body>
<div class="sg">
<header class="sg-top"><div class="sg-wrap"><img src="/logo-alt.png" alt=""><span class="sg-top-name">${esc(companyName)}</span></div></header>
${body}
</div>
</body>
</html>`
}
