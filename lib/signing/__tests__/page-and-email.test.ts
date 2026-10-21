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

  it('never loads anything from another site', () => {
    const html = renderSignerPage(view(), { token: TOKEN })
    expect(html).not.toMatch(/(src|href)="https?:/)
  })
})

describe('signing emails', () => {
  it('built-in templates use only supported placeholders and include the link', () => {
    for (const type of ['signing_request', 'signing_completed'] as const) {
      const known = new Set(TEMPLATE_TOKENS[type].map(t => t.key))
      const used = [...`${BUILT_IN_TEMPLATES[type].subject}\n${BUILT_IN_TEMPLATES[type].body}`.matchAll(/\{(\w+)\}/g)].map(m => m[1])
      for (const key of used) expect(known.has(key)).toBe(true)
    }
    for (const key of REQUIRED_TOKENS.signing_request ?? []) expect(BUILT_IN_TEMPLATES.signing_request.body).toContain(`{${key}}`)
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
