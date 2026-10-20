import { describe, expect, it } from 'vitest'
import { buildEmailRaw } from '../build-raw'
import { BUILT_IN_TEMPLATES, TEMPLATE_TOKENS, renderTemplate } from '../templates'

const decode = (raw: string) => Buffer.from(raw, 'base64url').toString()

describe('buildEmailRaw', () => {
  it('keeps plain-text emails single part', () => {
    const msg = decode(buildEmailRaw({ from: 'a@x.com', to: 'b@y.com', subject: 'Hi', body: 'Body' }))
    expect(msg).toContain('Content-Type: text/plain; charset=utf-8')
    expect(msg).not.toContain('multipart')
    expect(msg.endsWith('\r\n\r\nBody')).toBe(true)
  })

  it('builds multipart/mixed with a base64 attachment, cc and encoded subject', () => {
    const pdf = Buffer.from('%PDF-1.4 test')
    const msg = decode(buildEmailRaw({
      from: 'a@x.com', to: 'b@y.com', cc: 'c@z.com', subject: 'Work Order – 1 Main St', body: 'Hello',
      attachments: [{ filename: 'WO-1.pdf', mimeType: 'application/pdf', content: pdf }],
    }))
    const boundary = /boundary="([^"]+)"/.exec(msg)![1]
    expect(msg).toContain('Cc: c@z.com')
    expect(msg).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/)
    expect(msg).toContain('Content-Disposition: attachment; filename="WO-1.pdf"')
    expect(msg).toContain(pdf.toString('base64'))
    expect(msg).toContain(Buffer.from('Hello').toString('base64'))
    expect(msg.trimEnd().endsWith(`--${boundary}--`)).toBe(true)
  })
})

describe('renderTemplate', () => {
  it('fills known tokens, blanks nulls and leaves unknown tokens visible', () => {
    expect(renderTemplate('{a} {b} {typo}', { a: 'x', b: null })).toBe('x  {typo}')
  })

  it('built-in work order template uses only supported tokens', () => {
    const t = BUILT_IN_TEMPLATES.work_order
    const out = renderTemplate(`${t.subject}\n${t.body}`, Object.fromEntries(TEMPLATE_TOKENS.work_order.map(k => [k.key, 'v'])))
    expect(out).not.toMatch(/\{\w+\}/)
  })
})
