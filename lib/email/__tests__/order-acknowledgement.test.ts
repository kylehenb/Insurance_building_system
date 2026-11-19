import { describe, it, expect, vi, beforeEach } from 'vitest'

// The automatic reply to an order's sender when the order is lodged: who it
// goes to (and who it doesn't), the template it uses, threading into the
// order email, and the record on the job's comms log — plus what the order's
// checks add to it, and not sending when the office has already replied.

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
const inserted: Record<string, Row[]> = {}
function query(table: string) {
  const preds: ((r: Row) => boolean)[] = []
  const apply = () => (db[table] ?? []).filter(r => preds.every(p => p(r)))
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
    ilike: (c: string, p: string) => { const needle = p.replace(/%/g, '').toLowerCase(); preds.push(r => String(r[c] ?? '').toLowerCase().includes(needle)); return b },
    gte: (c: string, v: string) => { preds.push(r => String(r[c] ?? '') >= v); return b },
    order: () => b,
    limit: () => b,
    single: async () => ({ data: apply()[0] ?? null, error: null }),
    insert: async (row: Row) => { (inserted[table] ??= []).push(row); return { error: null } },
    upsert: async () => ({ error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: apply(), error: null }).then(res),
  }
  return b
}

const send = vi.fn()
const threadGet = vi.fn()
vi.mock('@/lib/gmail/client', () => ({ getGmailClient: () => ({ users: { messages: { send }, threads: { get: threadGet } } }) }))

const { sendOrderAcknowledgement, withOrderLines } = await import('../order-acknowledgement')
const supabase = { from: query } as never
const params = { tenantId: 't1', orderId: 'o1', jobId: 'j1' }
const decode = (raw: string) => Buffer.from(raw, 'base64url').toString()

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(inserted)) delete inserted[k]
  db.insurer_orders = [{ id: 'o1', order_sender_email: 'Casey.Adjuster@castle.com.au', order_sender_name: 'Casey Adjuster', raw_email_subject: 'New BAR request', created_at: '2026-10-28T02:00:00Z', insured_phone: '0412 345 678' }]
  db.jobs = [{ id: 'j1', job_number: 'IRC1080', claim_number: 'CLM1', insured_name: 'Peter Laundy', property_address: '45 Randell Cres', insurer: 'Castle', client_id: null }]
  db.tenants = [{ id: 't1', name: 'Insurance Repair Co', trading_name: null, contact_email: 'office@irc.test', contact_phone: null, email_signature: null, email_signature_image_path: null, email_signature_image_width: null, email_signature_image_height: null }]
  db.communications = [{ tenant_id: 't1', insurer_order_id: 'o1', direction: 'inbound', thread_id: 'th1', gmail_message_id: '<abc@mail.castle>', subject: 'New BAR request CLM1' }]
  db.email_templates = []
  send.mockResolvedValue({ data: { id: 'g1', threadId: 'th1' } })
  threadGet.mockResolvedValue({ data: { messages: [{ labelIds: ['INBOX'], payload: { headers: [{ name: 'From', value: 'Casey <Casey.Adjuster@castle.com.au>' }] } }] } })
})

describe('sendOrderAcknowledgement', () => {
  it('replies to the sender in the order thread with the default template and records it on the job', async () => {
    expect(await sendOrderAcknowledgement(supabase, params)).toEqual({ sent: true, to: 'Casey.Adjuster@castle.com.au' })
    const { requestBody } = send.mock.calls[0][0]
    expect(requestBody.threadId).toBe('th1')
    const msg = decode(requestBody.raw)
    expect(msg).toContain('To: Casey.Adjuster@castle.com.au')
    expect(msg).toContain('Subject: Re: New BAR request CLM1')
    expect(msg).toContain('In-Reply-To: <abc@mail.castle>')
    expect(inserted.communications[0]).toMatchObject({ job_id: 'j1', direction: 'outbound', source: 'order_acknowledgement', to_email: 'Casey.Adjuster@castle.com.au', thread_id: 'th1' })
    expect(inserted.communications[0].content).toContain('Hi Casey,')
    expect(inserted.communications[0].content).toContain('Our ref: IRC1080')
  })

  it('uses the tenant’s saved template and reads the Message-ID from Gmail for older orders', async () => {
    db.email_templates = [{ id: 'et1', tenant_id: 't1', send_type: 'order_acknowledgement', client_id: null, is_default: true, name: 'Mine', subject_template: 'Got it – {claim_number}', body_template: 'Thanks {contact_name}, booking soon.' }]
    db.communications[0].gmail_message_id = null
    threadGet.mockResolvedValue({ data: { messages: [{ payload: { headers: [{ name: 'Message-Id', value: '<old@mail>' }] } }] } })
    await sendOrderAcknowledgement(supabase, params)
    const msg = decode(send.mock.calls[0][0].requestBody.raw)
    expect(msg).toMatch(/Subject: (Got it – CLM1|=\?UTF-8\?B\?)/)
    expect(msg).toContain('In-Reply-To: <old@mail>')
    expect(inserted.communications[0].content).toContain('Thanks Casey, booking soon.')
  })

  it('skips orders with no sender, a no-reply sender or our own address', async () => {
    for (const email of [null, 'noreply@portal.test', 'do-not-reply@x.test', 'OFFICE@irc.test']) {
      db.insurer_orders[0].order_sender_email = email
      const res = await sendOrderAcknowledgement(supabase, params)
      expect(res.sent).toBe(false)
      expect(res.skipped).toBeTruthy()
    }
    expect(send).not.toHaveBeenCalled()
  })

  it('never throws when Gmail fails', async () => {
    send.mockRejectedValue(new Error('boom'))
    expect(await sendOrderAcknowledgement(supabase, params)).toEqual({ sent: false, skipped: 'The email could not be sent' })
  })

  it('asks the sender for the insured\'s number when the order has none, above the sign-off of a saved rich template', async () => {
    db.insurer_orders[0].insured_phone = null
    db.email_templates = [{ id: 'et1', tenant_id: 't1', send_type: 'order_acknowledgement', client_id: null, is_default: true, name: 'Standard', subject_template: 'Re: {order_subject}', body_template: '<p>Hi {contact_name},</p><p></p><p>Thanks for sending this through.</p><p></p><p>{signature}</p>' }]
    expect((await sendOrderAcknowledgement(supabase, params)).sent).toBe(true)
    const text = String(inserted.communications[0].content)
    expect(text).toMatch(/Thanks for sending this through\.\s+There was no contact number for the insured on the order\. Could you please send through the best phone number/)
  })

  it('sends the standard wording for a landline-only order', async () => {
    db.insurer_orders[0].insured_phone = '08 9381 2200'
    await sendOrderAcknowledgement(supabase, params)
    expect(String(inserted.communications[0].content)).not.toContain('contact number')
  })

  it('isn\'t sent when the office already replied in the order thread, from Gmail or the app', async () => {
    threadGet.mockResolvedValue({ data: { messages: [
      { labelIds: ['INBOX'], payload: { headers: [{ name: 'From', value: 'Casey.Adjuster@castle.com.au' }] } },
      { labelIds: ['SENT'], payload: { headers: [{ name: 'From', value: 'Kyle <office@irc.test>' }, { name: 'Date', value: 'Wed, 28 Oct 2026 10:22:00 +0800' }] } },
    ] } })
    const res = await sendOrderAcknowledgement(supabase, params)
    expect(res).toEqual({ sent: false, alreadyReplied: true, skipped: expect.stringMatching(/^The office already replied to Casey\.Adjuster@castle\.com\.au about this order on 28 Oct/) })
    expect(send).not.toHaveBeenCalled()
  })

  it('isn\'t sent when the office emailed the sender about the claim in another thread since the order came in', async () => {
    db.communications.push({ tenant_id: 't1', direction: 'outbound', to_email: 'casey.adjuster@castle.com.au', thread_id: 'other', subject: 'CLM1 – booking', body_text: '', created_at: '2026-10-28T03:00:00Z' })
    expect(await sendOrderAcknowledgement(supabase, params)).toMatchObject({ sent: false, alreadyReplied: true })
    expect(send).not.toHaveBeenCalled()
  })

  it('is still sent when the office only emailed the sender about other claims, or before the order', async () => {
    db.communications.push(
      { tenant_id: 't1', direction: 'outbound', to_email: 'casey.adjuster@castle.com.au', thread_id: 'other', subject: 'CLM9 – booking', body_text: '', created_at: '2026-10-28T03:00:00Z' },
      { tenant_id: 't1', direction: 'outbound', to_email: 'casey.adjuster@castle.com.au', thread_id: 'th1', subject: 'CLM1', body_text: '', created_at: '2026-10-20T03:00:00Z' },
    )
    expect((await sendOrderAcknowledgement(supabase, params)).sent).toBe(true)
  })
})

describe('withOrderLines', () => {
  const line = 'Please send a phone number.'
  it('goes where {order_notes} is, and the slot disappears when there is nothing to add', () => {
    const body = '<p>Hi,</p><p>{order_notes}</p><p></p><p>Thanks,</p><p>{signature}</p>'
    expect(withOrderLines(body, [line])).toBe('<p>Hi,</p><p>Please send a phone number.</p><p></p><p>Thanks,</p><p>{signature}</p>')
    expect(withOrderLines(body, [])).toBe('<p>Hi,</p><p>Thanks,</p><p>{signature}</p>')
  })

  it('goes above a sign-off and the signature in a template without {order_notes}', () => {
    expect(withOrderLines('Hi,\n\nBooking soon.\n\nKind regards,\n{signature}', [line]))
      .toBe('<p>Hi,</p><p></p><p>Booking soon.</p><p></p><p>Please send a phone number.</p><p></p><p>Kind regards,</p><p>{signature}</p>')
  })

  it('leaves the template as it was when there is nothing to add', () => {
    expect(withOrderLines('<p>Hi,</p><p>{signature}</p>', [])).toBe('<p>Hi,</p><p>{signature}</p>')
  })
})

const { DEFAULT_WORK_TYPE_LINES } = await import('@/lib/insurer-orders/acknowledgement-lines')
const { WORK_TYPES } = await import('@/lib/insurer-orders/work-order-type')

describe('what the acknowledgement says we\'ll do, for each work type the order asks for', () => {
  const LIVE_BODY = '<p>Hi {contact_name},</p><p></p><p>Thanks for sending this through. {work_type_lines}</p><p></p><p>{signature}</p>'
  const standard = (over: Row = {}) => ({ id: 'et1', tenant_id: 't1', send_type: 'order_acknowledgement', client_id: null, is_default: true, name: 'Standard', subject_template: 'Re: {order_subject}', body_template: LIVE_BODY, work_type_lines: null, ...over })
  const count = (text: string, needle: string) => text.split(needle).length - 1
  const sentText = () => String(inserted.communications.at(-1)?.content ?? '')

  // Every combination of the six types: 63 orders
  const combos: string[][] = []
  for (let mask = 1; mask < 1 << WORK_TYPES.length; mask++) combos.push(WORK_TYPES.filter((_, i) => mask & (1 << i)))

  it('says each requested type\'s line exactly once, make safe first, and nothing for types not asked for — every combination', async () => {
    db.email_templates = [standard()]
    for (const types of combos) {
      // Stored in any order: the email always follows the app's order
      db.insurer_orders[0].wo_types = [...types].reverse()
      for (const k of Object.keys(inserted)) delete inserted[k]
      expect((await sendOrderAcknowledgement(supabase, params)).sent).toBe(true)
      const text = sentText()
      const positions = types.map(t => text.indexOf(DEFAULT_WORK_TYPE_LINES[t]))
      for (const t of types) expect(count(text, DEFAULT_WORK_TYPE_LINES[t]), `${types.join('+')}: ${t}`).toBe(1)
      expect(positions, types.join('+')).toEqual([...positions].sort((a, b) => a - b))
      for (const t of WORK_TYPES.filter(t => !types.includes(t))) expect(text, `${types.join('+')} mentions ${t}`).not.toContain(DEFAULT_WORK_TYPE_LINES[t])
      // The BAR's appointment wording only ever comes with a BAR
      if (!types.includes('BAR')) expect(text).not.toMatch(/arrange an appointment|inspection/i)
      expect(text).not.toContain('{work_type_lines}')
    }
  })

  it('reads as one paragraph in the office\'s template: make safe and BAR', async () => {
    db.email_templates = [standard()]
    db.insurer_orders[0].wo_types = ['BAR', 'make_safe']
    await sendOrderAcknowledgement(supabase, params)
    expect(sentText()).toContain(`Thanks for sending this through. ${DEFAULT_WORK_TYPE_LINES.make_safe} ${DEFAULT_WORK_TYPE_LINES.BAR}`)
  })

  it('uses the lines edited in Settings: the client\'s version over the standard version over the defaults', async () => {
    db.jobs[0].client_id = 'c1'
    db.email_templates = [
      standard({ work_type_lines: { make_safe: 'Standard make safe line for {property_address}.', quote_only: 'Standard quote line.' } }),
      standard({ id: 'et2', client_id: 'c1', name: 'Castle', work_type_lines: { quote_only: 'Castle quote line.' } }),
    ]
    db.insurer_orders[0].wo_types = ['make_safe', 'BAR', 'quote_only']
    await sendOrderAcknowledgement(supabase, params)
    const text = sentText()
    expect(text).toContain('Standard make safe line for 45 Randell Cres.')
    expect(text).toContain(DEFAULT_WORK_TYPE_LINES.BAR)
    expect(text).toContain('Castle quote line.')
    expect(text).not.toContain('Standard quote line.')
  })

  it('adds the lines above the sign-off of a template written without {work_type_lines}', async () => {
    db.email_templates = [standard({ body_template: '<p>Hi {contact_name},</p><p></p><p>Thanks for sending this through.</p><p></p><p>Kind regards,</p><p>{signature}</p>' })]
    db.insurer_orders[0].wo_types = ['roof_report']
    await sendOrderAcknowledgement(supabase, params)
    expect(sentText()).toMatch(new RegExp(`Thanks for sending this through\\.\\s+${DEFAULT_WORK_TYPE_LINES.roof_report.replace(/\./g, '\\.')}\\s+Kind regards,`))
  })

  it('is held, not sent with the wrong wording, when the order has no work type or one the app doesn\'t know', async () => {
    db.email_templates = [standard()]
    for (const types of [[], ['variation'], ['BAR', 'Combination']]) {
      db.insurer_orders[0].wo_types = types
      const res = await sendOrderAcknowledgement(supabase, params)
      expect(res.sent).toBe(false)
      expect(res.skipped).toMatch(/work type/)
    }
    expect(send).not.toHaveBeenCalled()
  })

  it('reads an older order\'s single work type', async () => {
    db.email_templates = [standard()]
    db.insurer_orders[0].wo_types = []
    db.insurer_orders[0].wo_type = 'make_safe'
    await sendOrderAcknowledgement(supabase, params)
    expect(sentText()).toContain(DEFAULT_WORK_TYPE_LINES.make_safe)
  })
})
