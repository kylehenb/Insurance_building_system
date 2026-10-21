import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildEmailRaw } from '@/lib/email/build-raw'
import { BUILT_IN_TEMPLATES, REQUIRED_TOKENS, TEMPLATE_TOKENS, renderTemplate, signingTemplateVars } from '@/lib/email/templates'
import { renderBrandedEmailHtml } from '../email/html'
import { renderSignerPage, SIGNER_PAGE_CSP, SIGNER_SCRIPT_HASH } from '../signer-page/render'
import { SIGNER_SCRIPT } from '../signer-page/script'
import type { SignerView } from '../in-house/signer'

const TOKEN = 'A'.repeat(43)

function view(overrides: Partial<SignerView> = {}): SignerView {
  return {
    state: 'open',
    requestId: 'r1',
    documentName: 'Scope of Works Authorisation',
    documentTitle: 'Scope of Works Authorisation — 1 Example St',
    signerName: 'Jane Citizen',
    ownerName: 'Alex Citizen',
    propertyAddress: '1 Example St',
    companyName: 'Insurance Repair Co',
    expiresAt: '2026-11-04T00:00:00Z',
    signedAt: null,
    signedRecently: false,
    display: [
      { type: 'heading', text: 'Scope' },
      { type: 'paragraph', text: '<img src=x onerror=alert(1)> & more' },
      { type: 'scope', rooms: [{ room: 'Kitchen "A"', items: [{ description: '<script>bad()</script>', qty: '2 m2' }] }] },
      { type: 'signature', fieldId: 'f1', label: 'Authorise', context: 'Sign here' },
    ],
    fields: [{ id: 'f1', label: 'Authorise' }],
    excessInvoice: null,
    ...overrides,
  }
}

describe('signer page', () => {
  it('escapes everything that comes from the database', () => {
    const html = renderSignerPage(view(), { token: TOKEN })
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>bad()')
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;')
    expect(html).toContain('Kitchen &quot;A&quot;')
  })

  it('has one inline script, allowed by hash in a strict CSP', () => {
    const html = renderSignerPage(view(), { token: TOKEN })
    expect(html.match(/<script>/g)).toHaveLength(1)
    expect(SIGNER_SCRIPT_HASH).toBe(`sha256-${createHash('sha256').update(SIGNER_SCRIPT).digest('base64')}`)
    expect(SIGNER_PAGE_CSP).toContain(`'${SIGNER_SCRIPT_HASH}'`)
    expect(SIGNER_PAGE_CSP).toContain("default-src 'none'")
    expect(SIGNER_PAGE_CSP).not.toMatch(/https?:/)
  })

  it('posts to this token only, with the consent line before Finish', () => {
    const html = renderSignerPage(view(), { token: TOKEN })
    expect(html).toContain(`action="/api/sign/${TOKEN}/submit"`)
    expect(html.indexOf('By tapping Finish you agree to sign this document electronically.'))
      .toBeLessThan(html.indexOf('>Finish</button>'))
  })

  it('shows a friendly screen with contact details for every closed state', () => {
    for (const state of ['expired', 'revoked', 'not_found', 'signed'] as const) {
      const html = renderSignerPage(view({ state, display: [], fields: [] }), { token: TOKEN })
      expect(html).toContain('0431 132 077')
      expect(html).toContain('office@insurancerepairco.com.au')
      expect(html).not.toContain('<form')
    }
    expect(renderSignerPage('rate_limited', { token: TOKEN })).toContain('Please wait a moment')
  })

  it('asks who is signing, defaulting to the owner, with the owner named', () => {
    const html = renderSignerPage(view(), { token: TOKEN })
    expect(html).toContain('name="capacity" value="owner" checked')
    expect(html).toContain('value="joint_owner"')
    expect(html).toContain('value="authorised_person"')
    expect(html).toContain('On behalf of Alex Citizen')
    // name field comes before the type/draw choice, so it applies to both
    expect(html.indexOf('id="sg-typed-name"')).toBeLessThan(html.indexOf('name="method"'))
  })

  it('never loads anything from another site', () => {
    const html = renderSignerPage(view(), { token: TOKEN })
    expect(html).not.toMatch(/(src|href)="https?:/)
  })
})

describe('signer page with the real document pages', () => {
  const pages = { type: 'pages' as const, pages: [{ widthPt: 595.28, heightPt: 841.89 }, { widthPt: 595.28, heightPt: 841.89 }], imageType: 'image/png' as const }
  const rect = (page: number, x: number, y: number, width: number, height: number) => ({ page, x, y, width, height })
  const paged = (overrides: Partial<SignerView> = {}) => view({
    display: [pages, ...view().display],
    fields: [
      { id: 'f1', label: 'Authorise', signature: rect(1, 59.5, 420.945, 238.112, 42.1), date: rect(1, 400, 420, 100, 14), name: rect(1, 60, 400, 150, 14), representative: null },
    ],
    ...overrides,
  })

  it('shows every page image from this link, with the box placed on its page', () => {
    const html = renderSignerPage(paged(), { token: TOKEN })
    expect(html).toContain(`src="/api/sign/${TOKEN}/page/1"`)
    expect(html).toContain(`src="/api/sign/${TOKEN}/page/2"`)
    expect(html).toContain('Page 2 of 2')
    const box = html.match(/<div class="sg-field sg-onpage"[^>]*>/g) ?? []
    expect(box).toHaveLength(1)
    // x 59.5/595.28 = 10%, top (841.89-420.945-42.1)/841.89 = 45%, width 40%, height 5%
    expect(box[0]).toContain('left:9.995%;top:44.999%;width:40%;height:5.001%')
    expect(html.indexOf('id="page-2"')).toBeLessThan(html.indexOf('class="sg-field sg-onpage"'))
    expect(html).toContain('data-fill="date" data-for="f1"')
    expect(html).toContain('data-fill="name" data-for="f1"')
  })

  it('keeps the large-print wording, without a second set of signature boxes', () => {
    const html = renderSignerPage(paged(), { token: TOKEN })
    expect(html).toContain('Read the same wording in large print')
    expect(html).toContain('Authorise: you sign this on the document pages above.')
    expect(html.match(/class="sg-field/g)).toHaveLength(1)
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('falls back to the reading view for requests without page images', () => {
    const html = renderSignerPage(view(), { token: TOKEN })
    expect(html).not.toContain('sg-onpage"')
    expect(html).not.toContain('/page/1')
    expect(html).toContain('<section class="sg-field" id="field-1"')
  })
})

describe('signer page excess invoice', () => {
  const invoice = {
    ref: 'IRC1001-EX',
    amountIncGst: 500,
    dueText: 'on receipt',
    paidDate: null,
    bank: { bankName: 'CBA', accountName: 'Insurance Repair Co', bsb: '066-000', accountNumber: '1234 5678' },
  }

  it('shows the invoice, bank details and a download link on an open link', () => {
    const html = renderSignerPage(view({ excessInvoice: invoice }), { token: TOKEN })
    expect(html).toContain('Excess invoice IRC1001-EX')
    expect(html).toContain('$500.00')
    expect(html).toContain('066-000')
    expect(html).toContain(`/api/sign/${TOKEN}/invoice`)
    expect(html.toLowerCase()).not.toContain('unpaid')
    expect(html).not.toContain('overdue')
  })

  it('shows paid instead of bank details once recorded paid', () => {
    const html = renderSignerPage(view({ excessInvoice: { ...invoice, paidDate: '2026-10-25' } }), { token: TOKEN })
    expect(html).toContain('paid 25 Oct 2026')
    expect(html).not.toContain('066-000')
  })

  it('mentions it on the thank-you screen', () => {
    const html = renderSignerPage(
      view({ state: 'signed', signedRecently: true, signedAt: '2026-10-21T02:00:00Z', display: [], fields: [], excessInvoice: invoice }),
      { token: TOKEN, done: '1' },
    )
    expect(html).toContain('Thank you, you’ve signed')
    expect(html).toContain('The only other thing is your excess')
    expect(html).toContain('066-000')
  })

  it('has no invoice card without one', () => {
    expect(renderSignerPage(view(), { token: TOKEN })).not.toContain('Your excess')
  })
})

describe('signing emails', () => {
  it('built-in templates use only supported placeholders and include the link', () => {
    for (const type of ['signing_request', 'signing_request_excess', 'signing_completed'] as const) {
      const known = new Set(TEMPLATE_TOKENS[type].map(t => t.key))
      const used = [...`${BUILT_IN_TEMPLATES[type].subject}\n${BUILT_IN_TEMPLATES[type].body}`.matchAll(/\{(\w+)\}/g)].map(m => m[1])
      for (const key of used) expect(known.has(key)).toBe(true)
    }
    for (const key of REQUIRED_TOKENS.signing_request ?? []) expect(BUILT_IN_TEMPLATES.signing_request.body).toContain(`{${key}}`)
    for (const key of REQUIRED_TOKENS.signing_request_excess ?? []) expect(BUILT_IN_TEMPLATES.signing_request_excess.body).toContain(`{${key}}`)
  })

  it('excess template fills in the invoice details', () => {
    const vars = signingTemplateVars({
      signerName: 'Jane Citizen',
      documentName: 'Scope of Works Authorisation',
      job: { job_number: 'IRC1', claim_number: null, insured_name: 'Jane', property_address: '1 Example St' },
      tenant: { name: 'IRC', trading_name: 'Insurance Repair Co', contact_phone: '0431132077', contact_email: 'office@insurancerepairco.com.au' },
      signingLink: 'https://app/sign/x',
      expiryDate: '4 Nov 2026',
      excessAmount: '$500.00',
      invoiceRef: 'IRC1001-EX',
      excessDue: 'on receipt',
    })
    const subject = renderTemplate(BUILT_IN_TEMPLATES.signing_request_excess.subject, vars)
    const body = renderTemplate(BUILT_IN_TEMPLATES.signing_request_excess.body, vars)
    expect(subject).toContain('1 Example St')
    expect(body).toContain('https://app/sign/x')
    expect(body).toContain('$500.00')
    expect(body).toContain('IRC1001-EX')
    expect(body).not.toMatch(/\{\w+\}/)
  })

  it('subject includes the property address', () => {
    const vars = signingTemplateVars({
      signerName: 'Jane Citizen',
      documentName: 'Building Contract',
      job: { job_number: 'IRC1', claim_number: null, insured_name: 'Jane', property_address: '1 Example St' },
      tenant: { name: 'IRC', trading_name: 'Insurance Repair Co', contact_phone: '0431132077', contact_email: 'office@insurancerepairco.com.au' },
      signingLink: 'https://app/sign/x',
      expiryDate: '4 Nov 2026',
    })
    expect(renderTemplate(BUILT_IN_TEMPLATES.signing_request.subject, vars)).toBe('Please sign your Building Contract – 1 Example St')
    expect(renderTemplate(BUILT_IN_TEMPLATES.signing_request.body, vars)).toContain('Hi Jane,')
    expect(vars.company_phone).toBe('0431 132 077')
  })

  it('branded HTML turns the link paragraph into a button and escapes text', () => {
    const html = renderBrandedEmailHtml({
      text: 'Hi <b>Jane</b>,\n\nhttps://app.example/sign/abc\n\nThanks',
      actionUrl: 'https://app.example/sign/abc',
      actionLabel: 'Review and sign',
      logoUrl: null,
      companyName: 'Insurance Repair Co',
      footerLines: ['x'],
    })
    expect(html).toContain('Review and sign</a>')
    expect(html).toContain('Hi &lt;b&gt;Jane&lt;/b&gt;,')
  })

  it('buildEmailRaw adds a Bcc header for the office copy', () => {
    const raw = Buffer.from(buildEmailRaw({ from: 'a@b.co', to: 'c@d.co', bcc: 'office@b.co', subject: 'S', body: 'x' }), 'base64url').toString()
    expect(raw).toContain('Bcc: office@b.co')
  })

  it('buildEmailRaw sends text and HTML as alternatives', () => {
    const raw = Buffer.from(buildEmailRaw({ from: 'a@b.co', to: 'c@d.co', subject: 'S', body: 'plain', html: '<p>html</p>' }), 'base64url').toString()
    expect(raw).toContain('multipart/alternative')
    expect(raw).toContain('text/plain')
    expect(raw).toContain('text/html')
    const withAttachment = Buffer.from(buildEmailRaw({
      from: 'a@b.co', to: 'c@d.co', subject: 'S', body: 'plain', html: '<p>html</p>',
      attachments: [{ filename: 'x.pdf', mimeType: 'application/pdf', content: Buffer.from('%PDF') }],
    }), 'base64url').toString()
    expect(withAttachment).toContain('multipart/mixed')
    expect(withAttachment).toContain('multipart/alternative')
    expect(withAttachment).toContain('filename="x.pdf"')
  })
})
