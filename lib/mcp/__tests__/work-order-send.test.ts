import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WorkOrderSummary } from '../tools/work-orders'

// The voice send tools are thin: they pass the user's choices to the app's own
// send function and turn its refusals into something Claude can say.

class WorkOrderEmailError extends Error {
  constructor(message: string, public readonly status: number) { super(message) }
}
class WorkOrderPdfError extends WorkOrderEmailError {}

const summaries = new Map<string, WorkOrderSummary>()
const buildDraft = vi.fn()
const send = vi.fn()
vi.mock('@/lib/mcp/tools/work-orders', () => ({
  summariseWorkOrder: async (id: string) => summaries.get(id) ?? null,
  money: (n: number) => `$${n}`,
}))
vi.mock('@/lib/work-orders/work-order-email', () => ({
  buildWorkOrderEmailDraft: (...a: unknown[]) => buildDraft(...a),
  sendWorkOrderEmail: (...a: unknown[]) => send(...a),
  WorkOrderEmailError,
}))
vi.mock('@/lib/work-orders/work-order-pdf', () => ({ WorkOrderPdfError }))

const { getWorkOrderEmail, sendWorkOrder } = await import('../tools/work-order-send')

const ID = 'e3d43087-1acc-41fa-898d-cbdcc034ae34'
const ctx = { supabase: {} as never, tenantId: 't1', userId: 'u1' }
const unsent: WorkOrderSummary = {
  work_order_id: ID, job_number: 'IRC1001', property_address: '123 Test Street', trade: 'Electrician',
  business_name: 'Sparky Ltd', recipient: null, amount: null, sent: false, last_sent: null,
  status: 'pending', gary_state: 'not_started',
  warnings: ['Sparky Ltd has no email address — ask who to send it to.', 'The amount is $0 — no allocation set.'],
}

beforeEach(() => {
  vi.clearAllMocks()
  summaries.clear()
  summaries.set(ID, { ...unsent })
  buildDraft.mockResolvedValue({
    to: '', cc: '', subject: 'Work Order WO-1 - 123 Test Street (IRC1001)', body: '<p>Hi <strong>Sparky</strong>,</p><p></p><p>Please find attached…</p>', bodyText: 'Hi Sparky,\n\nPlease find attached…',
    attachmentName: 'WO-1 - Sparky Ltd - 123 Test Street.pdf',
    photos: { count: 4, attachmentName: 'Photos - IRC1001.pdf', jobId: 'j1' },
    tradeName: 'Sparky Ltd', templateName: 'Work order — default', usingBuiltInTemplate: true,
  })
  send.mockImplementation(async () => {
    summaries.set(ID, { ...unsent, sent: true, gary_state: 'waiting_reply', warnings: [] })
    return { communicationId: 'c1' }
  })
})

describe('get_work_order_email', () => {
  it('reads back recipient, amount, warnings, attachments and the standard email', async () => {
    const res = await getWorkOrderEmail.run({ work_order_id: ID }, ctx)
    expect(buildDraft).toHaveBeenCalledWith(ID, ctx)
    expect(res.text).toContain('Electrician (Sparky Ltd) on IRC1001, 123 Test Street.')
    expect(res.text).toContain('To: no email address on file. Amount: $0.')
    expect(res.text).toContain('Warnings: Sparky Ltd has no email address')
    expect(res.text).toContain('and 4 photos as Photos - IRC1001.pdf')
    expect(res.text).toContain('Body:\nHi Sparky,\n\nPlease find attached…')
    expect(res.data).toMatchObject({ body: 'Hi Sparky,\n\nPlease find attached…', subject: 'Work Order WO-1 - 123 Test Street (IRC1001)', attachments: ['WO-1 - Sparky Ltd - 123 Test Street.pdf', 'Photos - IRC1001.pdf'] })
  })

  it('says an already-sent work order can’t be sent again', async () => {
    summaries.set(ID, { ...unsent, sent: true, warnings: ['Already sent on Tue, 20 Oct to kyle@example.com.'] })
    const res = await getWorkOrderEmail.run({ work_order_id: ID }, ctx)
    expect(res.text).toMatch(/Already sent on Tue, 20 Oct to kyle@example\.com\. It can't be sent again/)
    expect(buildDraft).not.toHaveBeenCalled()
  })

  it('rejects an unknown or malformed id without touching the app', async () => {
    expect((await getWorkOrderEmail.run({ work_order_id: 'nope' }, ctx)).isError).toBe(true)
    expect((await getWorkOrderEmail.run({ work_order_id: '00000000-0000-0000-0000-000000000000' }, ctx)).isError).toBe(true)
    expect(buildDraft).not.toHaveBeenCalled()
  })
})

describe('send_work_order', () => {
  it('sends the standard email through the app’s send function', async () => {
    summaries.set(ID, { ...unsent, recipient: 'sparky@example.com' })
    const res = await sendWorkOrder.run({ work_order_id: ID }, ctx)
    expect(send).toHaveBeenCalledWith(ID, ctx, { to: undefined, subject: undefined, body: undefined, includePhotos: true })
    expect(res.isError).toBeFalsy()
    expect(res.text).toBe('Sent the Electrician (Sparky Ltd) work order for IRC1001 to sparky@example.com. Gary is now waiting on their reply.')
  })

  it('passes the user’s address, wording and photo choice', async () => {
    const res = await sendWorkOrder.run({ work_order_id: ID, to: 'kyle@example.com', body: 'Custom body', include_photos: false }, ctx)
    expect(send).toHaveBeenCalledWith(ID, ctx, { to: 'kyle@example.com', subject: undefined, body: 'Custom body', includePhotos: false })
    expect(res.text).toContain('to kyle@example.com, without photos.')
  })

  it('passes on the app’s refusal instead of retrying', async () => {
    send.mockRejectedValueOnce(new WorkOrderEmailError('This work order has already been sent', 409))
    const res = await sendWorkOrder.run({ work_order_id: ID, to: 'kyle@example.com' }, ctx)
    expect(res).toMatchObject({ text: 'This work order has already been sent', isError: true, data: { status: 409 } })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('lets unexpected errors reach the server’s generic “check the app” message', async () => {
    send.mockRejectedValueOnce(new Error('socket hang up'))
    await expect(sendWorkOrder.run({ work_order_id: ID }, ctx)).rejects.toThrow('socket hang up')
  })
})
