import { describe, it, expect } from 'vitest'
import {
  forwardSubject, quoteHtml, quoteText, readAddressInput, replyRecipients, replySubject, splitQuote,
  type QuotedEmail,
} from '../compose-rules'
import { buildEmailRaw } from '@/lib/email/build-raw'

const OWN = 'office@insurancerepairco.com.au'
const jane = { name: 'Jane Smith', email: 'jane@insurer.com' }
const claims = { name: '', email: 'claims@insurer.com' }
const bob = { name: 'Bob', email: 'bob@trade.com' }
const office = { name: 'IRC', email: OWN }

describe('replyRecipients', () => {
  it('replies to the sender', () => {
    expect(replyRecipients({ from: jane, to: [office, bob], cc: [claims], replyTo: [], labelIds: ['INBOX'] }, OWN, false))
      .toEqual({ to: [jane], cc: [] })
  })

  it('uses Reply-To when there is one', () => {
    expect(replyRecipients({ from: jane, to: [office], cc: [], replyTo: [claims], labelIds: ['INBOX'] }, OWN, false).to).toEqual([claims])
  })

  it('reply all adds everyone else, without us or duplicates', () => {
    expect(replyRecipients({ from: jane, to: [office, bob, jane], cc: [claims, { name: 'Office', email: 'OFFICE@insurancerepairco.com.au' }], replyTo: [], labelIds: ['INBOX'] }, OWN, true))
      .toEqual({ to: [jane, bob], cc: [claims] })
  })

  it('replying to our own email goes to its recipients again', () => {
    expect(replyRecipients({ from: office, to: [bob], cc: [claims], replyTo: [], labelIds: ['SENT'] }, OWN, true))
      .toEqual({ to: [bob], cc: [claims] })
  })
})

describe('subjects', () => {
  it('adds Re: and Fwd: once', () => {
    expect(replySubject('Roof leak')).toBe('Re: Roof leak')
    expect(replySubject('RE: Roof leak')).toBe('RE: Roof leak')
    expect(forwardSubject('Roof leak')).toBe('Fwd: Roof leak')
    expect(forwardSubject('FW: Roof leak')).toBe('FW: Roof leak')
  })
})

describe('readAddressInput', () => {
  it('reads typed addresses and flags bad ones', () => {
    expect(readAddressInput('Jane Smith <jane@insurer.com>; bob@trade.com, nope')).toEqual({
      addresses: [jane, { name: '', email: 'bob@trade.com' }],
      invalid: ['nope'],
    })
  })
})

describe('quoting', () => {
  const q: QuotedEmail = {
    from: jane, to: [office], cc: [], subject: 'Roof leak',
    date: '2026-10-23T06:39:00.000Z',
    html: '<html><head><style>p{color:red}</style></head><body><p>Please quote.</p><img src="cid:logo"><script>x()</script></body></html>',
    text: 'Please quote.\nThanks',
  }

  it('quotes a reply the way Gmail does, without the original\'s styles, scripts or inline images', () => {
    const html = quoteHtml(q, 'reply')
    expect(html).toContain('class="gmail_quote"')
    expect(html).toContain('On Fri, 23 Oct 2026 at 2:39 pm, Jane Smith &lt;jane@insurer.com&gt; wrote:')
    expect(html).toContain('<p>Please quote.</p>')
    expect(html).not.toMatch(/<style|<script|cid:|<body/)
    expect(quoteText(q, 'reply')).toBe('On Fri, 23 Oct 2026 at 2:39 pm, Jane Smith <jane@insurer.com> wrote:\n> Please quote.\n> Thanks')
  })

  it('adds the forwarded header block', () => {
    expect(quoteHtml(q, 'forward')).toContain('---------- Forwarded message ---------<br>From: <strong>Jane Smith &lt;jane@insurer.com&gt;</strong>')
    expect(quoteText(q, 'forward')).toContain('Subject: Roof leak\nTo: IRC <office@insurancerepairco.com.au>\n\nPlease quote.')
  })

  it('splits what was written from the quote', () => {
    const html = `<p>Thanks Jane</p>${quoteHtml(q, 'reply')}`
    expect(splitQuote(html).body).toBe('<p>Thanks Jane</p>')
    expect(splitQuote(html).quote).toMatch(/^<div class="gmail_quote">/)
    expect(splitQuote('<p>Just text</p>')).toEqual({ body: '<p>Just text</p>', quote: null })
  })
})

describe('drafts without recipients', () => {
  it('leaves out an empty To header', () => {
    const raw = Buffer.from(buildEmailRaw({ from: OWN, to: '', subject: 'Hi', body: 'x' }), 'base64url').toString()
    expect(raw).not.toMatch(/^To:/m)
  })
})

describe('scheduled send times (Perth)', async () => {
  const { parseSendAt, schedulePresets, spokenSendAt, isoToPerthLocal } = await import('../schedule-rules')

  it('reads Perth wall-clock times and ISO times', () => {
    expect(parseSendAt('2026-10-26T08:00')).toBe('2026-10-26T00:00:00.000Z')
    expect(parseSendAt('2026-10-26 08:00')).toBe('2026-10-26T00:00:00.000Z')
    expect(parseSendAt('2026-10-26T08:00:00+10:00')).toBe('2026-10-25T22:00:00.000Z')
    expect(parseSendAt('next tuesday')).toBeNull()
    expect(isoToPerthLocal('2026-10-26T00:00:00.000Z')).toBe('2026-10-26T08:00')
    expect(spokenSendAt('2026-10-26T05:30:00.000Z')).toBe('Mon 26 Oct, 1:30 pm')
  })

  it('offers tomorrow morning and afternoon, and Monday morning', () => {
    // Friday 23 Oct 2026, 9pm Perth
    const presets = schedulePresets(new Date('2026-10-23T13:00:00.000Z'))
    expect(presets.map(p => [p.label, spokenSendAt(p.at)])).toEqual([
      ['Tomorrow morning', 'Sat 24 Oct, 8:00 am'],
      ['Tomorrow afternoon', 'Sat 24 Oct, 1:00 pm'],
      ['Monday morning', 'Mon 26 Oct, 8:00 am'],
    ])
    // Sunday: tomorrow is Monday, so no separate Monday option
    expect(schedulePresets(new Date('2026-10-25T02:00:00.000Z')).map(p => p.label)).toEqual(['Tomorrow morning', 'Tomorrow afternoon'])
  })
})
