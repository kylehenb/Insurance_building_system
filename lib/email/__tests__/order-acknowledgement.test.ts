import { describe, it, expect, vi, beforeEach } from 'vitest'

// The automatic reply to an order's sender when the order is lodged: who it
// goes to (and who it doesn't), the template it uses, threading into the
// order email, and the record on the job's comms log.

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
const inserted: Record<string, Row[]> = {}
function query(table: string) {
  const preds: ((r: Row) => boolean)[] = []
  const apply = () => (db[table] ?? []).filter(r => preds.every(p => p(r)))
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
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

const { sendOrderAcknowledgement } = await import('../order-acknowledgement')
const supabase = { from: query } as never
const params = { tenantId: 't1', orderId: 'o1', jobId: 'j1' }
const decode = (raw: string) => Buffer.from(raw, 'base64url').toString()

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(inserted)) delete inserted[k]
  db.insurer_orders = [{ id: 'o1', order_sender_email: 'Casey.Adjuster@castle.com.au', order_sender_name: 'Casey Adjuster', raw_email_subject: 'New BAR request' }]
  db.jobs = [{ id: 'j1', job_number: 'IRC1080', claim_number: 'CLM1', insured_name: 'Peter Laundy', property_address: '45 Randell Cres', insurer: 'Castle', client_id: null }]
  db.tenants = [{ id: 't1', name: 'Insurance Repair Co', trading_name: null, contact_email: 'office@irc.test', contact_phone: null, email_signature: null, email_signature_image_path: null, email_signature_image_width: null, email_signature_image_height: null }]
  db.communications = [{ tenant_id: 't1', insurer_order_id: 'o1', direction: 'inbound', thread_id: 'th1', gmail_message_id: '<abc@mail.castle>', subject: 'New BAR request CLM1' }]
  db.email_templates = []
  send.mockResolvedValue({ data: { id: 'g1', threadId: 'th1' } })
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
})
