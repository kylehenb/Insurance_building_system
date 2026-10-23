import { describe, it, expect, vi, beforeEach } from 'vitest'

// The scheduler sends what's due once, never twice, and records failures.

type Row = Record<string, unknown>
let rows: Row[] = []
const sendDraft = vi.fn(async (_m: unknown, draftId: string) => {
  if (draftId === 'gone') throw new Error('This draft no longer exists — it may already have been sent')
  return { messageId: `sent-${draftId}`, threadId: 't' }
})
const activity: Row[] = []

function table(name: string) {
  const preds: ((r: Row) => boolean)[] = []
  let patch: Row | null = null
  let limit = Infinity
  const matching = () => (name === 'mailboxes' ? [{ id: 'mb1' }] : rows).filter(r => preds.every(p => p(r)))
  const run = () => {
    const hit = matching().slice(0, limit)
    if (patch) for (const r of hit) Object.assign(r, patch)
    return hit
  }
  const b: Record<string, unknown> = {
    select: () => b,
    update: (p: Row) => { patch = p; return b },
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
    lt: (c: string, v: string) => { preds.push(r => String(r[c]) < v); return b },
    lte: (c: string, v: string) => { preds.push(r => String(r[c]) <= v); return b },
    order: () => b,
    limit: (n: number) => { limit = n; return b },
    single: async () => ({ data: run()[0] ?? null, error: null }),
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(res),
  }
  return b
}
const db = { from: table }

vi.mock('../compose', () => ({ sendDraft: (m: unknown, d: string) => sendDraft(m, d), describeDraft: vi.fn(), ComposeError: Error }))
vi.mock('@/lib/activity/log', () => ({ recordActivity: async (e: Row) => { activity.push(e) } }))
vi.mock('@/lib/gmail/client', () => ({ getGmailClient: () => ({}) }))
vi.mock('../sync', () => ({ mailDb: () => db }))

const { sendDueEmails } = await import('../scheduled')
const NOW = new Date('2026-10-26T00:00:30.000Z')
const row = (id: string, o: Row = {}): Row => ({
  id, tenant_id: 't1', mailbox_id: 'mb1', gmail_draft_id: id, thread_id: 't', status: 'scheduled',
  send_at: '2026-10-26T00:00:00.000Z', subject: `Email ${id}`, recipients: 'bob@trade.com', created_by: 'u1',
  updated_at: '2026-10-25T00:00:00.000Z', ...o,
})

beforeEach(() => {
  sendDraft.mockClear()
  activity.length = 0
})

describe('sendDueEmails', () => {
  it('sends what is due, leaves later ones, and records each', async () => {
    rows = [row('a'), row('later', { send_at: '2026-10-26T08:00:00.000Z' }), row('cancelled', { status: 'cancelled' })]
    expect(await sendDueEmails(db as never, NOW)).toEqual({ sent: 1, failed: 0 })
    expect(sendDraft.mock.calls.map(c => c[1])).toEqual(['a'])
    expect(rows[0]).toMatchObject({ status: 'sent', sent_message_id: 'sent-a' })
    expect(rows[1].status).toBe('scheduled')
    expect(activity[0].summary).toMatch(/^Sent the scheduled email "Email a" to bob@trade.com/)
  })

  it('never sends one twice when runs overlap', async () => {
    rows = [row('a')]
    await Promise.all([sendDueEmails(db as never, NOW), sendDueEmails(db as never, NOW)])
    expect(sendDraft).toHaveBeenCalledTimes(1)
  })

  it('marks failures, and interrupted sends, as failed rather than retrying', async () => {
    rows = [row('gone'), row('stuck', { status: 'sending', updated_at: '2026-10-25T23:00:00.000Z' })]
    expect(await sendDueEmails(db as never, NOW)).toEqual({ sent: 0, failed: 1 })
    expect(rows[0]).toMatchObject({ status: 'failed', error: 'This draft no longer exists — it may already have been sent' })
    expect(rows[1]).toMatchObject({ status: 'failed' })
    expect(String(rows[1].error)).toMatch(/check Sent/)
    expect(sendDraft.mock.calls.map(c => c[1])).toEqual(['gone'])
  })
})
