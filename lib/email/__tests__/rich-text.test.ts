import { describe, expect, it } from 'vitest'
import {
  composeEmailBody,
  isRichText,
  plainTextToRichHtml,
  renderRichTemplate,
  richToText,
  toRichHtml,
  type EmailSignature,
} from '../rich-text'

const SIGNATURE: EmailSignature = {
  html: '<p><strong>Kyle Bindon</strong></p><p>Insurance Repair Co</p>',
  text: 'Kyle Bindon\nInsurance Repair Co',
  image: { url: 'https://cdn.example/logo.png', width: 160, height: 48, alt: 'Insurance Repair Co' },
}

const compose = (body: string, signature: EmailSignature | null = null) =>
  composeEmailBody(body, { fontSize: 15, signature, signatureFallback: 'Insurance Repair Co' })

describe('rich text: stored form', () => {
  it('turns older plain-text templates into one paragraph per line, keeping blank lines', () => {
    expect(isRichText('Hi {name},\n\nThanks')).toBe(false)
    expect(plainTextToRichHtml('Hi {name},\n\nThanks & bye\n\n')).toBe('<p>Hi {name},</p><p></p><p>Thanks &amp; bye</p>')
    expect(richToText(plainTextToRichHtml('Hi,\n\nThanks'))).toBe('Hi,\n\nThanks')
  })

  it('keeps the editor formats and drops everything else', () => {
    const dirty = '<p style="text-align: center" class="x" onclick="evil()">A <strong>b</strong> <em>c</em> <u>d</u> <s>e</s>' +
      '<span style="color: rgb(192, 38, 28); font-size: 20px; font-family: Comic Sans">f</span>' +
      '<a href="javascript:alert(1)">bad</a> <a href="https://ok.example" target="_blank">ok</a></p>' +
      '<script>alert(1)</script><img src=x onerror=alert(1)><h1>Big</h1><ul><li><p>one</p></li></ul>'
    expect(toRichHtml(dirty)).toBe(
      '<p style="text-align: center">A <strong>b</strong> <em>c</em> <u>d</u> <s>e</s>' +
      '<span style="color: #c0261c; font-size: 20px">f</span>bad <a href="https://ok.example">ok</a></p>' +
      '<h2>Big</h2><ul><li><p>one</p></li></ul>')
  })

  it('is stable: cleaning the cleaned form changes nothing', () => {
    const once = toRichHtml('<p>Hi <b>there</b><br>line two</p><p></p><h3>Sub</h3><ol><li><p>a</p></li><li><p>b</p></li></ol>')
    expect(toRichHtml(once)).toBe(once)
  })
})

describe('rich text: placeholders', () => {
  it('fills and escapes values, leaves unknown ones and {signature}', () => {
    const out = renderRichTemplate('<p>Hi <strong>{name}</strong>, {unknown} {signature}</p>', { name: '<Jane & Co>', signature: 'X' })
    expect(out).toBe('<p>Hi <strong>&lt;Jane &amp; Co&gt;</strong>, {unknown} {signature}</p>')
  })

  it('fills a placeholder used as a link address', () => {
    expect(renderRichTemplate('<p><a href="{signing_link}">Sign here</a></p>', { signing_link: 'https://app.example/sign/abc' }))
      .toBe('<p><a href="https://app.example/sign/abc">Sign here</a></p>')
  })
})

describe('rich text: sending', () => {
  it('inlines every style and keeps blank lines visible', () => {
    const { html } = compose('<p>Hi</p><p></p><h2>Next steps</h2><ul><li><p>One</p></li></ul>')
    expect(html).not.toMatch(/class=|<style/)
    expect(html).toContain('<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;">Hi</p>')
    expect(html).toContain('>&nbsp;</p>')
    expect(html).toMatch(/<h2 style="[^"]*font-size:22px;[^"]*font-weight:bold;/)
    expect(html).toMatch(/<ul style="margin:0 0 0 28px;padding:0;[^"]*"><li style="[^"]*">One<\/li><\/ul>/)
  })

  it('links bare URLs and gives the plain-text version with link addresses', () => {
    const { html, text } = compose('<p>See https://example.com/a?b=1&c=2.</p><p><a href="https://x.example">our site</a></p>')
    expect(html).toContain('<a href="https://example.com/a?b=1&amp;c=2" ')
    expect(html).toContain('>https://example.com/a?b=1&amp;c=2</a>.')
    expect(text).toBe('See https://example.com/a?b=1&c=2.\nour site (https://x.example)')
  })

  it('shows a line that is exactly the action link as the button', () => {
    const { html, text } = composeEmailBody('<p>Please sign:</p><p>https://app.example/sign/abc</p>', {
      fontSize: 18, signature: null, signatureFallback: '', action: { url: 'https://app.example/sign/abc', html: '<BUTTON>' },
    })
    expect(html).toContain('<BUTTON>')
    expect(text).toContain('https://app.example/sign/abc')
  })

  it('puts the signature (text and logo) where {signature} is', () => {
    const { html, text } = compose('<p>Kind regards,</p><p>{signature}</p>', SIGNATURE)
    expect(html).toContain('<strong>Kyle Bindon</strong>')
    expect(html).toContain('<img src="https://cdn.example/logo.png" width="160" height="48" alt="Insurance Repair Co"')
    expect(html).not.toContain('{signature}')
    expect(text).toBe('Kind regards,\nKyle Bindon\nInsurance Repair Co')
  })

  it('keeps the signature on separate lines when {signature} shares a line with other text', () => {
    const { html } = compose('<p>Thanks, {signature}</p>', SIGNATURE)
    expect(html).toContain('Thanks, Kyle Bindon<br>Insurance Repair Co</p>')
  })

  it('puts the logo on its {logo} line, between the signature lines', () => {
    const sig = { ...SIGNATURE, html: '<p>Kyle Bindon</p><p>{logo}</p><p>0431 132 077</p>' }
    const { html } = compose('<p>{signature}</p>', sig)
    expect(html.indexOf('Kyle Bindon')).toBeLessThan(html.indexOf('<img'))
    expect(html.indexOf('<img')).toBeLessThan(html.indexOf('0431 132 077'))
    expect(html.match(/<img/g)).toHaveLength(1)
    expect(html).not.toContain('{logo}')
  })

  it('leaves out the {logo} line when there is no image', () => {
    const { html } = compose('<p>{signature}</p>', { ...SIGNATURE, html: '<p>Kyle</p><p>{logo}</p>', image: null })
    expect(html).not.toContain('{logo}')
    expect(html).not.toContain('<img')
  })

  it('adds the signature at the end when the template has no {signature}', () => {
    const { html, text } = compose('Thanks,', SIGNATURE)
    expect(html.indexOf('Thanks,')).toBeLessThan(html.indexOf('Kyle Bindon'))
    expect(text).toBe('Thanks,\n\nKyle Bindon\nInsurance Repair Co')
  })

  it('uses the company name for {signature} when no signature is set up', () => {
    const { html, text } = compose('Kind regards,\n{signature}')
    expect(text).toBe('Kind regards,\nInsurance Repair Co')
    expect(html).toContain('>Insurance Repair Co</p>')
  })
})

describe('signature from tenant settings', () => {
  it('leaves the logo line out of the plain-text version', async () => {
    const { emailSignatureFor } = await import('../signature')
    const sig = emailSignatureFor({
      name: 'IRC', trading_name: 'Insurance Repair Co',
      email_signature: '<p>Kyle Bindon</p><p>{logo}</p><p>0431 132 077</p>',
      email_signature_image_path: null, email_signature_image_width: null, email_signature_image_height: null,
    })
    expect(sig?.text).toBe('Kyle Bindon\n0431 132 077')
  })
})
