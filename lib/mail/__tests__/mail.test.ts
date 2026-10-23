import { describe, it, expect } from 'vitest'
import type { gmail_v1 } from 'googleapis'
import { decodeEntities, historyThreadIds, parseAddresses, summariseThread } from '../summary'
import { parseMessage, resolveCidImages } from '../message'
import { cleanEmailHtml, emailDocument, hasRemoteImages, textToHtml } from '../html'
import { applyAction, inFolder, undoAction, type MailAction } from '../folders'

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64url')

function msg(opts: {
  id: string
  at: number
  from: string
  to?: string
  subject?: string
  labels?: string[]
  snippet?: string
  mimeType?: string
}): gmail_v1.Schema$Message {
  return {
    id: opts.id,
    threadId: 't1',
    internalDate: String(opts.at),
    labelIds: opts.labels ?? ['INBOX'],
    snippet: opts.snippet ?? '',
    payload: {
      mimeType: opts.mimeType ?? 'text/plain',
      headers: [
        { name: 'From', value: opts.from },
        { name: 'To', value: opts.to ?? 'office@insurancerepairco.com.au' },
        { name: 'Subject', value: opts.subject ?? 'Roof leak' },
      ],
    },
  }
}

describe('parseAddresses', () => {
  it('splits on commas outside quotes and angle brackets', () => {
    expect(parseAddresses('"Smith, John" <john@x.com>, b@y.com, Jane Doe <jane@z.com>')).toEqual([
      { name: 'Smith, John', email: 'john@x.com' },
      { name: '', email: 'b@y.com' },
      { name: 'Jane Doe', email: 'jane@z.com' },
    ])
  })

  it('handles empty headers', () => {
    expect(parseAddresses('')).toEqual([])
  })
})

describe('decodeEntities', () => {
  it('decodes the entities Gmail puts in snippets', () => {
    expect(decodeEntities('Can&#39;t attend &amp; won&#x27;t &lt;sorry&gt;')).toBe("Can't attend & won't <sorry>")
  })
})

describe('summariseThread', () => {
  it('summarises a conversation the way Gmail lists it', () => {
    const s = summariseThread({
      id: 't1',
      messages: [
        msg({ id: 'm2', at: 2000, from: 'IRC Office <office@insurancerepairco.com.au>', to: 'Jane <jane@insurer.com>', labels: ['SENT'], snippet: 'Thanks Jane' }),
        msg({ id: 'm1', at: 1000, from: 'Jane <jane@insurer.com>', subject: 'Roof leak - 13 Pepper Close', labels: ['INBOX'] }),
        msg({ id: 'm3', at: 3000, from: 'Jane <jane@insurer.com>', labels: ['INBOX', 'UNREAD'], snippet: 'Quote approved &amp; signed', mimeType: 'multipart/mixed' }),
      ],
    })!
    expect(s.subject).toBe('Roof leak - 13 Pepper Close')
    expect(s.snippet).toBe('Quote approved & signed')
    expect(s.participants).toEqual([
      { name: 'Jane', email: 'jane@insurer.com', me: false },
      { name: 'IRC Office', email: 'office@insurancerepairco.com.au', me: true },
    ])
    expect(s.message_count).toBe(3)
    expect(s.last_message_at).toBe(new Date(3000).toISOString())
    expect(s.label_ids).toEqual(['INBOX', 'SENT', 'UNREAD'])
    expect(s.unread).toBe(true)
    expect(s.has_attachments).toBe(true)
  })

  it('leaves a reply draft out of the count, snippet and date but keeps its label', () => {
    const s = summariseThread({
      id: 't1',
      messages: [
        msg({ id: 'm1', at: 1000, from: 'jane@insurer.com', snippet: 'Original' }),
        msg({ id: 'd1', at: 5000, from: 'office@insurancerepairco.com.au', labels: ['DRAFT'], snippet: 'Half written' }),
      ],
    })!
    expect(s.message_count).toBe(1)
    expect(s.snippet).toBe('Original')
    expect(s.last_message_at).toBe(new Date(1000).toISOString())
    expect(s.label_ids).toContain('DRAFT')
  })

  it('lists a thread that is only a draft', () => {
    const s = summariseThread({
      id: 't1',
      messages: [msg({ id: 'd1', at: 5000, from: 'office@insurancerepairco.com.au', to: 'Bob <bob@trade.com>', labels: ['DRAFT'], snippet: 'Hi Bob' })],
    })!
    expect(s.message_count).toBe(1)
    expect(s.snippet).toBe('Hi Bob')
    expect(s.recipients).toEqual([{ name: 'Bob', email: 'bob@trade.com' }])
  })

  it('returns null for a thread with no messages', () => {
    expect(summariseThread({ id: 't1', messages: [] })).toBeNull()
  })
})

describe('historyThreadIds', () => {
  it('collects every thread touched, once', () => {
    expect(historyThreadIds([
      { messagesAdded: [{ message: { id: 'a', threadId: 't1' } }] },
      { labelsRemoved: [{ message: { id: 'b', threadId: 't2' }, labelIds: ['INBOX'] }] },
      { labelsAdded: [{ message: { id: 'a', threadId: 't1' }, labelIds: ['TRASH'] }] },
      { messagesDeleted: [{ message: { id: 'c', threadId: 't3' } }] },
    ]).sort()).toEqual(['t1', 't2', 't3'])
  })
})

describe('parseMessage', () => {
  const message: gmail_v1.Schema$Message = {
    id: 'abc',
    threadId: 't1',
    internalDate: '1000',
    labelIds: ['INBOX'],
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: 'Jane <jane@insurer.com>' },
        { name: 'To', value: 'office@insurancerepairco.com.au' },
        { name: 'Cc', value: 'claims@insurer.com' },
        { name: 'Subject', value: 'Photos' },
      ],
      parts: [
        {
          mimeType: 'multipart/related',
          parts: [
            {
              mimeType: 'multipart/alternative',
              parts: [
                { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=utf-8' }], body: { data: b64('See photos') } },
                { mimeType: 'text/html', headers: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: { data: b64('<p>See <img src="cid:logo@x"> photos</p>') } },
              ],
            },
            {
              mimeType: 'image/png',
              filename: 'logo.png',
              headers: [{ name: 'Content-ID', value: '<logo@x>' }, { name: 'Content-Disposition', value: 'inline' }],
              body: { attachmentId: 'ATT1', size: 1200 },
            },
          ],
        },
        {
          mimeType: 'application/pdf',
          filename: 'report.pdf',
          headers: [{ name: 'Content-Disposition', value: 'attachment; filename="report.pdf"' }],
          body: { attachmentId: 'ATT2', size: 50000 },
        },
      ],
    },
  }

  it('reads headers, both bodies and the attachments', () => {
    const m = parseMessage(message)
    expect(m.from).toEqual({ name: 'Jane', email: 'jane@insurer.com' })
    expect(m.cc).toEqual([{ name: '', email: 'claims@insurer.com' }])
    expect(m.text).toBe('See photos')
    expect(m.html).toContain('cid:logo@x')
    expect(m.attachments.map(a => [a.filename, a.inline])).toEqual([['logo.png', true], ['report.pdf', false]])
  })

  it('points cid: images at the attachment route', () => {
    const m = parseMessage(message)
    const html = resolveCidImages(m.html, m.id, m.attachments)
    expect(html).toContain('src="/api/mail/attachments?m=abc&a=ATT1')
    expect(html).not.toContain('cid:')
  })

  it('decodes a non-UTF-8 body using its charset', () => {
    const latin1 = Buffer.from('Café', 'latin1').toString('base64url')
    const m = parseMessage({
      id: 'x',
      payload: { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="iso-8859-1"' }], parts: [] },
    })
    expect(m.text).toBe('')
    const m2 = parseMessage({
      id: 'x',
      payload: { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="iso-8859-1"' }], body: { data: latin1 } }] },
    })
    expect(m2.text).toBe('Café')
  })
})

describe('email html', () => {
  it('strips scripts, refreshes and base tags', () => {
    const cleaned = cleanEmailHtml('<base href="http://evil"><meta http-equiv="refresh" content="0;url=http://evil"><script>alert(1)</script><p>Hi</p>')
    expect(cleaned).toBe('<p>Hi</p>')
  })

  it('blocks remote images until asked', () => {
    expect(emailDocument('<p>x</p>', { showRemoteImages: false })).toContain("img-src 'self' data: blob:;")
    expect(emailDocument('<p>x</p>', { showRemoteImages: true })).toContain("img-src 'self' data: blob: *;")
    expect(hasRemoteImages('<img src="https://tracker.example/p.gif">')).toBe(true)
    expect(hasRemoteImages('<img src="/api/mail/attachments?m=1">')).toBe(false)
  })

  it('escapes plain text and links URLs', () => {
    expect(textToHtml('<b> see https://example.com/a?b=1.')).toContain('&lt;b&gt; see <a href="https://example.com/a?b=1">https://example.com/a?b=1</a>.')
  })
})

describe('folders and actions', () => {
  it('puts conversations in folders and inbox tabs the way Gmail does', () => {
    expect(inFolder('inbox', ['INBOX', 'UNREAD'], 'primary')).toBe(true)
    expect(inFolder('inbox', ['INBOX', 'CATEGORY_PROMOTIONS'], 'primary')).toBe(false)
    expect(inFolder('inbox', ['INBOX', 'CATEGORY_PROMOTIONS'], 'promotions')).toBe(true)
    expect(inFolder('inbox', ['INBOX', 'CATEGORY_UPDATES'], 'primary')).toBe(true)
    // Binned or spam conversations leave every other folder
    expect(inFolder('inbox', ['INBOX', 'TRASH'])).toBe(false)
    expect(inFolder('all', ['SENT', 'SPAM'])).toBe(false)
    expect(inFolder('trash', ['INBOX', 'TRASH'])).toBe(true)
    expect(inFolder('all', ['SENT'])).toBe(true)
  })

  it('applies actions to labels', () => {
    expect(applyAction(['INBOX', 'UNREAD'], 'archive')).toEqual(['UNREAD'])
    expect(applyAction(['INBOX'], 'spam')).toEqual(['SPAM'])
    expect(applyAction(['SPAM'], 'not_spam')).toEqual(['INBOX'])
    expect(applyAction(['TRASH', 'SENT'], 'inbox')).toEqual(['INBOX', 'SENT'])
    expect(applyAction(['INBOX', 'UNREAD'], 'read')).toEqual(['INBOX'])
    expect(applyAction(['INBOX'], 'trash')).toEqual(['INBOX', 'TRASH'])
  })

  it('undoes each action back to where the conversation was', () => {
    const cases: [MailAction, string[]][] = [
      ['archive', ['INBOX', 'UNREAD']],
      ['trash', ['INBOX']],
      ['trash', ['SENT']],
      ['spam', ['INBOX']],
      ['not_spam', ['SPAM']],
      ['inbox', ['TRASH']],
      ['inbox', ['SENT']],
      ['read', ['INBOX', 'UNREAD']],
      ['unread', ['INBOX']],
    ]
    for (const [action, before] of cases) {
      const after = applyAction(before, action)
      const restored = applyAction(after, undoAction(action, before))
      // Gmail's trash keeps the other labels, so compare where it shows rather than the exact set
      for (const folder of ['inbox', 'sent', 'all', 'spam', 'trash'] as const) {
        expect(inFolder(folder, restored), `${action} on ${before} in ${folder}`).toBe(inFolder(folder, before))
      }
      expect(restored.includes('UNREAD')).toBe(before.includes('UNREAD'))
    }
  })
})
