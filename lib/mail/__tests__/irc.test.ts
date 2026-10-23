import { describe, it, expect, vi, beforeEach } from 'vitest'
import { filingOf } from '../filing'
import { jobContacts } from '../job-context'
import { snoozePresets, spokenSendAt } from '../schedule-rules'

// Phase 5: where a conversation stands in IRC, who to email about a job,
// snooze times, and bringing snoozed conversations back.

const row = (o: Partial<{ job_id: string | null; source: string | null; direction: string | null; insurer_order_id: string | null }>) =>
  ({ job_id: null, source: null, direction: 'inbound', insurer_order_id: null, created_at: null, ...o })

describe('filingOf', () => {
  it('is on the newest linked job', () => {
    expect(filingOf([row({ job_id: 'j2' }), row({ job_id: 'j1' })])).toEqual({ filing: 'job', jobId: 'j2' })
  })
  it('is admin, then waits in the orders queue, then is to file', () => {
    expect(filingOf([row({ source: 'admin' })]).filing).toBe('admin')
    expect(filingOf([row({ insurer_order_id: 'o1' }), row({})]).filing).toBeNull()
    expect(filingOf([row({ source: 'unlinked' })]).filing).toBe('to_file')
  })
  it('is nothing when the app never recorded an incoming email', () => {
    expect(filingOf([]).filing).toBeNull()
    expect(filingOf([row({ direction: 'outbound' })]).filing).toBeNull()
  })
})

describe('jobContacts', () => {
  it('lists the insured, order sender, insurer and adjuster inboxes and other contacts once each', () => {
    const contacts = jobContacts(
      {
        insured_name: 'Zane Kenny', insured_email: 'zane@example.com',
        order_sender_name: 'Casey', order_sender_email: 'casey@castle.com',
        contacts: [
          { slot: 'insured', name: 'Zane Kenny', email: 'ZANE@example.com', phone: '', roles: [] },
          { slot: 'additional_1', type: 'property_manager', name: 'Pat', email: 'pat@realty.com', phone: '', roles: [] },
          { slot: 'additional_2', type: 'tenant', name: 'No email', email: '', phone: '', roles: [] },
        ],
      },
      { name: 'Castle', submission_email: 'claims@castle.com', adjuster_submission_email: null },
    )
    expect(contacts.map(c => `${c.label}:${c.email}`)).toEqual([
      'Insured:zane@example.com', 'Order sender:casey@castle.com', 'Insurer inbox:claims@castle.com', 'Property manager:pat@realty.com',
    ])
  })
})

describe('snoozePresets', () => {
  it('offers later today, tomorrow, this weekend and next week on a weekday morning', () => {
    // Thursday 22 Oct 2026, 9 am Perth
    expect(snoozePresets(new Date('2026-10-22T01:00:00.000Z')).map(p => [p.label, spokenSendAt(p.at)])).toEqual([
      ['Later today', 'Thu 22 Oct, 6:00 pm'],
      ['Tomorrow', 'Fri 23 Oct, 8:00 am'],
      ['This weekend', 'Sat 24 Oct, 8:00 am'],
      ['Next week', 'Mon 26 Oct, 8:00 am'],
    ])
  })
  it('drops later today in the evening and this weekend on the weekend', () => {
    // Saturday 24 Oct 2026, 7 pm Perth
    expect(snoozePresets(new Date('2026-10-24T11:00:00.000Z')).map(p => p.label)).toEqual(['Tomorrow', 'Next week'])
  })
})

// ── wakeSnoozed against an in-memory database ──

type Row = Record<string, unknown>
let snoozes: Row[] = []
let threads: Row[] = []
const modify = vi.fn(async (_a: unknown) => ({}))
vi.mock('@/lib/gmail/client', () => ({ getGmailClient: () => ({ users: { threads: { modify } } }) }))
vi.mock('../sync', () => ({ mailDb: () => db, fetchThreads: vi.fn(async () => 1) }))
vi.mock('../actions', () => ({ applyThreadAction: vi.fn() }))

function table(name: string) {
  const preds: ((r: Row) => boolean)[] = []
  let patch: Row | null = null
  const source = () => (name === 'mail_snoozes' ? snoozes : name === 'mail_threads' ? threads : [{ id: 'mb1' }])
  const run = () => {
    const hit = source().filter(r => preds.every(p => p(r)))
    if (patch) for (const r of hit) Object.assign(r, patch)
    return hit
  }
  const b: Record<string, unknown> = {
    select: () => b,
    update: (p: Row) => { patch = p; return b },
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
    in: (c: string, v: unknown[]) => { preds.push(r => v.includes(r[c])); return b },
    contains: (c: string, v: string[]) => { preds.push(r => v.every(x => (r[c] as string[]).includes(x))); return b },
    single: async () => ({ data: run()[0] ?? null }),
    maybeSingle: async () => ({ data: run()[0] ?? null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(res),
  }
  return b
}
const db = { from: table }
const { wakeSnoozed } = await import('../snooze')

describe('wakeSnoozed', () => {
  beforeEach(() => modify.mockClear())

  it('brings due ones back unread, leaves later ones, and stands down when a reply already did', async () => {
    snoozes = [
      { id: 's1', mailbox_id: 'mb1', gmail_thread_id: 't1', until: '2026-10-26T00:00:00.000Z', status: 'snoozed' },
      { id: 's2', mailbox_id: 'mb1', gmail_thread_id: 't2', until: '2026-10-30T00:00:00.000Z', status: 'snoozed' },
      { id: 's3', mailbox_id: 'mb1', gmail_thread_id: 't3', until: '2026-10-30T00:00:00.000Z', status: 'snoozed' },
    ]
    threads = [{ mailbox_id: 'mb1', gmail_thread_id: 't3', label_ids: ['INBOX', 'UNREAD'] }]
    expect(await wakeSnoozed(db as never, new Date('2026-10-26T00:00:30.000Z'))).toEqual({ woken: 2 })
    expect(modify).toHaveBeenCalledTimes(1)
    expect(modify.mock.calls[0][0]).toMatchObject({ id: 't1', requestBody: { addLabelIds: ['INBOX', 'UNREAD'] } })
    expect(snoozes.map(s => s.status)).toEqual(['woken', 'snoozed', 'woken'])
  })
})
