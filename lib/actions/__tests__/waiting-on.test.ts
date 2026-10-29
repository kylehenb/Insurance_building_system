import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'

// Waiting on: each email the office sends is read once; one that asks
// someone for something sets a follow-up for whoever sent it, timed from the
// office's past waits and the job. A reply closes it, a later email can bring
// it forward, and what the office does with it — moving it, cancelling it,
// chasing — is learned from.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables) as never

let detail: Row | null
vi.mock('@/lib/mail/sync', () => ({ getMailbox: async () => ({ id: 'mb1', tenant_id: 't1' }), mailDb: () => db }))
vi.mock('@/lib/mail/list', () => ({ getThreadDetail: async () => detail }))
vi.mock('@/lib/mcp/tools/mailbox', () => ({ readConversation: { run: async () => ({ text: 'Kyle: Can you send the switchboard photos for IRC1001?' }) } }))
vi.mock('@/lib/mcp/tools/jobs', () => ({ getJobSummary: { run: async () => ({ text: 'IRC1001 — homeowner complained twice about delays. Suncorp asked for the electrical report on 27 Oct.' }) } }))

const { readSentEmail, claimSent } = await import('../waiting-on')
const { closeAnsweredWaits, bringForward, waitBrief, recordChaseDecision, listWaits, FEATURE } = await import('../waits')
const { chaseDue, workingDaysBetween, updateFollowUp, cancelFollowUp } = await import('../followups')
const { recordSent, recordSyncedSends } = await import('@/lib/mail/sent-by')

// Thu 29 Oct 2026, 10am in Perth
const THU = new Date('2026-10-29T02:00:00Z')

const sentDetail = (o: Row = {}): Row => ({
  id: 'abc1', subject: 'Switchboard photos', label_ids: ['SENT'], job: { id: 'j1', job_number: 'IRC1001' },
  messages: [{
    id: 'm9', labelIds: ['SENT'], from: { name: 'IRC', email: 'office@insurancerepairco.com.au' },
    to: [{ name: 'Sparky Bros', email: 'jobs@sparkybros.com.au' }], cc: [], subject: 'Switchboard photos',
    date: THU.toISOString(), text: 'Hi Dan, can you send the switchboard photos for IRC1001? Suncorp needs them.',
  }],
  ...o,
})

/** A fake model that answers record_wait */
function model(input: Row) {
  const create = vi.fn(async () => ({ content: [{ type: 'tool_use', id: 'tu1', name: 'record_wait', input }], stop_reason: 'tool_use' }))
  return { client: { beta: { messages: { create } } } as never, create }
}

const sentRow = (o: Row = {}) => ({ id: 's1', tenant_id: 't1', gmail_message_id: 'm9', thread_id: 'abc1', sent_by: 'u2', status: 'reading', attempts: 1, created_at: THU.toISOString(), ...o })

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  tables.users = [{ id: 'admin1', tenant_id: 't1', role: 'admin', name: 'Kyle' }, { id: 'u2', tenant_id: 't1', role: 'office', name: 'Sam' }]
  tables.jobs = [{ id: 'j1', tenant_id: 't1', job_number: 'IRC1001', insurer: 'Suncorp', job_type: 'insurance', current_stage: 'report', loss_type: 'storm' }]
  tables.trades = [{ id: 'tr1', tenant_id: 't1', business_name: 'Sparky Bros Electrical', primary_trade: 'Electrician', contact_email: 'jobs@sparkybros.com.au' }]
  tables.sent_emails = [sentRow()]
  detail = sentDetail()
})

describe('when to chase', () => {
  it('counts working days, and keeps a same-day chase inside office hours', () => {
    expect(chaseDue(2, new Date('2026-10-24T07:00:00Z'))).toBe('2026-10-27T00:00:00.000Z') // Sat → Tue 8am
    expect(chaseDue(1, new Date('2026-10-30T02:00:00Z'))).toBe('2026-11-02T00:00:00.000Z') // Fri → Mon 8am
    expect(chaseDue(0, THU)).toBe('2026-10-29T05:00:00.000Z') // in 3 hours
    expect(chaseDue(0, new Date('2026-10-29T08:00:00Z'))).toBe('2026-10-30T00:00:00.000Z') // 4pm → Fri 8am
    expect(chaseDue(0, new Date('2026-10-24T02:00:00Z'))).toBe('2026-10-26T00:00:00.000Z') // Saturday → Mon 8am
    expect(workingDaysBetween(THU.toISOString(), '2026-11-02T00:00:00.000Z')).toBe(2)
  })
})

describe('who sent it', () => {
  it('records a send from IRC with its sender, and the sync adds the rest without anyone', async () => {
    tables.sent_emails = []
    await recordSent(db, 't1', 'a1', 'abc1', 'u2')
    await recordSyncedSends(db, 't1', [{ messageId: 'a1', threadId: 'abc1' }, { messageId: 'b1', threadId: 'abc2' }])
    expect(tables.sent_emails.map(r => [r.gmail_message_id, r.sent_by ?? null])).toEqual([['a1', 'u2'], ['b1', null]])
  })

  it('takes sent emails to read once each, after a short wait', async () => {
    tables.sent_emails = [
      { id: 's1', tenant_id: 't1', status: 'new', attempts: 0, created_at: '2026-10-29T01:00:00.000Z' },
      { id: 's2', tenant_id: 't1', status: 'new', attempts: 0, created_at: '2026-10-29T01:59:50.000Z' },
    ]
    const [a, b] = await Promise.all([claimSent(db, 5, THU), claimSent(db, 5, THU)])
    expect([...a, ...b].map(r => r.id)).toEqual(['s1'])
    expect(tables.sent_emails[0]).toMatchObject({ status: 'reading', attempts: 1 })
  })
})

describe('reading a sent email', () => {
  // A chase has to be in the future: read as if it's that Thursday
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(THU) })
  afterEach(() => { vi.useRealTimers() })

  it('sets a follow-up for the sender when it asks for something, timed by the AI with the reason', async () => {
    const { client, create } = model({
      asks: true, waiting_on_name: 'Sparky Bros Electrical', waiting_on_email: 'jobs@sparkybros.com.au', role: 'trade',
      asked: 'the switchboard photos', ask_kind: 'photos', on_behalf_of: 'Suncorp asked for them on 27 Oct',
      chase_after_working_days: 1, urgent: true, reason: 'The homeowner has complained twice and Suncorp is waiting, so tomorrow.',
    })
    const out = await readSentEmail(sentRow() as never, { db, client, at: THU })
    expect(out).toMatchObject({ status: 'done', outcome: 'Asked Sparky Bros Electrical for the switchboard photos — chase Fri 30 Oct' })
    const fu = tables.action_queue[0]
    expect(fu).toMatchObject({
      source: 'followup', rule_key: 'waiting_on', status: 'scheduled', job_id: 'j1', due_at: '2026-10-30T00:00:00.000Z', priority: 90,
      title: 'Waiting on Sparky Bros Electrical: the switchboard photos',
      follow_up: {
        kind: 'waiting_on', who: 'Sparky Bros Electrical', thread_id: 'abc1', created_by: 'u2',
        waiting: {
          email: 'jobs@sparkybros.com.au', role: 'trade', ask_kind: 'photos', message_id: 'm9', ai_days: 1, on_behalf_of: 'Suncorp asked for them on 27 Oct',
          situation: { waiting_on_email: 'jobs@sparkybros.com.au', trade_type: 'Electrician', role: 'trade', insurer: 'Suncorp', sent_by: 'Sam' },
        },
      },
    })
    expect(tables.sent_emails[0]).toMatchObject({ status: 'done', follow_up_id: fu.id })
    // It read the email, the conversation and the job
    const prompt = (create.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0].content
    expect(prompt).toContain('THE EMAIL JUST SENT')
    expect(prompt).toContain('(sent by Sam)')
    expect(prompt).toContain('homeowner complained twice')
  })

  it('reads the office\'s past waits on the same trade first, and its lessons', async () => {
    tables.learning_events = [
      { id: 'e1', tenant_id: 't1', feature: FEATURE, source_id: 'w-other', situation: { role: 'trade', ask_kind: 'quote' }, situation_text: 'Waiting on Ace Roofing — trade', outcome: 'edited', changes: ['The office moved the chase later: to 5 working days'], created_at: '2026-10-10T00:00:00.000Z' },
      { id: 'e2', tenant_id: 't1', feature: FEATURE, source_id: 'w-sparky', situation: { waiting_on_email: 'jobs@sparkybros.com.au', role: 'trade' }, situation_text: 'Waiting on Sparky Bros', outcome: 'edited', changes: ['The office moved the chase later: to 7 working days'], created_at: '2026-10-01T00:00:00.000Z' },
      { id: 'e3', tenant_id: 't1', feature: FEATURE, source_id: 'w-sparky', situation: { waiting_on_email: 'jobs@sparkybros.com.au', role: 'trade' }, situation_text: 'Waiting on Sparky Bros', outcome: 'accepted', changes: ['Sparky Bros replied 6 working days after the email'], created_at: '2026-10-08T00:00:00.000Z' },
      { id: 'e4', tenant_id: 't1', feature: 'action_card', source_id: 'c1', situation: { waiting_on_email: 'jobs@sparkybros.com.au' }, outcome: 'accepted', changes: [], created_at: '2026-10-09T00:00:00.000Z' },
    ]
    tables.learning_lessons = [{ id: 'l1', tenant_id: 't1', feature: FEATURE, status: 'active', applies_when: 'Electricians asked for photos', lesson: 'Give them a week', support_count: 3, contradict_count: 0 }]
    const { client, create } = model({ asks: false })
    await readSentEmail(sentRow() as never, { db, client, at: THU })
    const prompt = (create.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0].content
    expect(prompt).toContain('Give them a week')
    const cases = prompt.slice(prompt.indexOf('SIMILAR PAST CASES'))
    // The same trade first, once (its newest decision), then the broad match; not other features
    expect(cases.indexOf('replied 6 working days')).toBeGreaterThan(0)
    expect(cases).not.toContain('to 7 working days')
    expect(cases.indexOf('replied 6 working days')).toBeLessThan(cases.indexOf('to 5 working days'))
  })

  it('sets nothing when it asks for nothing, or only goes to the office', async () => {
    const { client, create } = model({ asks: false })
    expect(await readSentEmail(sentRow() as never, { db, client, at: THU })).toMatchObject({ status: 'done', outcome: 'Asks for nothing' })
    detail = sentDetail({ messages: [{ ...(sentDetail().messages as Row[])[0], to: [{ name: 'Jo', email: 'jo@insurancerepairco.com.au' }] }] })
    expect(await readSentEmail(sentRow() as never, { db, client, at: THU })).toMatchObject({ outcome: 'Only to the office' })
    expect(create).toHaveBeenCalledTimes(1)
    expect(tables.action_queue ?? []).toHaveLength(0)
  })

  it('replaces the reminder when the office asks again in the same conversation', async () => {
    tables.action_queue = [{ id: 'old', tenant_id: 't1', source: 'followup', rule_key: 'waiting_on', status: 'scheduled', follow_up: { thread_id: 'abc1', waiting: { name: 'Sparky Bros', asked: 'photos', sent_at: '2026-10-26T02:00:00.000Z' } }, due_at: '2026-10-30T00:00:00.000Z' }]
    const { client } = model({ asks: true, waiting_on_name: 'Sparky Bros', waiting_on_email: 'jobs@sparkybros.com.au', role: 'trade', asked: 'the photos', ask_kind: 'photos', chase_after_working_days: 2, reason: 'Second ask.' })
    await readSentEmail(sentRow() as never, { db, client, at: THU })
    expect(tables.action_queue.map(r => [r.id, r.status])).toEqual([['old', 'skipped'], [expect.any(String), 'scheduled']])
  })

  it('tries again later when it fails, then gives up', async () => {
    const client = { beta: { messages: { create: vi.fn(async () => { throw new Error('overloaded') }) } } } as never
    expect(await readSentEmail(sentRow() as never, { db, client, at: THU })).toMatchObject({ status: 'new' })
    expect(await readSentEmail(sentRow({ attempts: 3 }) as never, { db, client, at: THU })).toMatchObject({ status: 'failed' })
  })
})

/** A wait as readSentEmail sets it: asked Thu 29 Oct, chase Mon 2 Nov */
const wait = (o: Row = {}): Row => ({
  id: '00000000-0000-0000-0000-00000000000a', tenant_id: 't1', job_id: 'j1', source: 'followup', rule_key: 'waiting_on', status: 'scheduled',
  title: 'Waiting on Sparky Bros: the photos', due_at: '2099-11-02T00:00:00.000Z', steps: [], situation: { kind: 'followup' },
  follow_up: {
    kind: 'waiting_on', note: 'Chase Sparky Bros', who: 'Sparky Bros', thread_id: 'abc1', created_by: 'u2', from_card_id: null,
    waiting: { name: 'Sparky Bros', email: 'jobs@sparkybros.com.au', role: 'trade', asked: 'the photos', ask_kind: 'photos', on_behalf_of: null, message_id: 'm9', sent_at: '2099-10-29T02:00:00.000Z', ai_days: 2, ai_due_at: '2099-11-02T00:00:00.000Z', reason: 'Usually 2 days.', situation: { waiting_on_email: 'jobs@sparkybros.com.au', role: 'trade' } },
  },
  ...o,
})

describe('what happens to a wait', () => {
  it('is answered by a reply in its conversation, and learned from', async () => {
    tables.action_queue = [wait(), wait({ id: 'other', follow_up: { ...(wait().follow_up as Row), thread_id: 'abc2' } })]
    expect(await closeAnsweredWaits(db, 't1', [{ messageId: 'r1', threadId: 'abc1' }])).toBe(1)
    expect(tables.action_queue.map(r => r.status)).toEqual(['done', 'scheduled'])
    expect(tables.action_queue[0].outcome).toBe('Answered — Sparky Bros replied')
    expect(tables.learning_events[0]).toMatchObject({
      feature: FEATURE, outcome: 'accepted', kind: null, source_id: tables.action_queue[0].id,
      situation: { waiting_on_email: 'jobs@sparkybros.com.au', role: 'trade' },
      changes: [expect.stringMatching(/^Sparky Bros replied .* before the chase \(set for 2 working days\)$/)],
    })
  })

  it('learns when a person moves the chase, and when they cancel it', async () => {
    tables.action_queue = [wait()]
    await updateFollowUp(db, 't1', wait().id as string, { dueAt: '2099-11-09T00:00:00.000Z' }, 'u1')
    expect(tables.learning_events[0]).toMatchObject({
      outcome: 'edited', user_id: 'u1',
      changes: ['The office moved the chase later: from Mon 2 Nov (2 working days after the email) to Mon 9 Nov (7 working days after)'],
    })
    expect(await cancelFollowUp(db, 't1', wait().id as string, 'u1')).toBe(true)
    expect(tables.learning_events[1]).toMatchObject({ outcome: 'skipped', changes: [expect.stringMatching(/^The office cancelled the wait/)] })
    // An ordinary follow-up isn't a wait: nothing learned
    tables.action_queue = [wait({ id: '00000000-0000-0000-0000-00000000000b', rule_key: 'followup', follow_up: { note: 'Call Jo', who: null, thread_id: null, created_by: 'u1', from_card_id: null } })]
    await updateFollowUp(db, 't1', '00000000-0000-0000-0000-00000000000b', { dueAt: '2099-11-09T00:00:00.000Z' }, 'u1')
    expect(tables.learning_events).toHaveLength(2)
  })

  it('learns whether the chase was sent once it came onto the cards', async () => {
    const card = wait({ status: 'done', steps: [{ id: 's1', tool: 'send_email', status: 'done', args: {}, summary: 'Reply', kind: 'email' }] })
    await recordChaseDecision(db, card as never, 'u1', 'confirmed')
    await recordChaseDecision(db, wait({ status: 'skipped' }) as never, 'u1', 'skipped')
    expect(tables.learning_events.map(e => [e.outcome, (e.changes as string[])[0].slice(0, 30)])).toEqual([
      ['accepted', 'Nothing came in 2 working days'],
      ['skipped', 'The chase came up after 2 work'],
    ])
  })

  it('comes sooner — never later — when a later email makes it urgent', async () => {
    tables.action_queue = [wait()]
    const id = wait().id as string
    expect(await bringForward(db, 't1', id, '2099-11-20', 'later?', THU)).toBe(false)
    expect(await bringForward(db, 't1', id, 'now', 'Suncorp is chasing the report', THU)).toBe(true)
    expect(tables.action_queue[0]).toMatchObject({ due_at: new Date(THU.getTime() + 60_000).toISOString(), priority: 90 })
    expect((tables.action_queue[0].follow_up as { waiting: { brought_forward: Row[] } }).waiting.brought_forward).toEqual([{ at: THU.toISOString(), to: tables.action_queue[0].due_at, reason: 'Suncorp is chasing the report' }])
  })

  it('tells the reply\'s card what was being waited on, and the card for another email on the job what else is', async () => {
    tables.action_queue = [
      wait({ status: 'done', outcome: 'Answered — Sparky Bros replied', updated_at: new Date().toISOString() }),
      wait({ id: 'w2', follow_up: { ...(wait().follow_up as Row), thread_id: 'abc2' } }),
    ]
    const brief = await waitBrief(db, 't1', 'abc1', 'j1')
    expect(brief).toMatch(/^THE OFFICE WAS WAITING ON THIS REPLY\nSparky Bros — the photos \(asked /)
    expect(brief).toContain('THE OFFICE IS ALSO WAITING ON (other conversations on this job)\n- follow_up_id w2: Sparky Bros — the photos')
    expect(await waitBrief(db, 't1', 'abc9', null)).toBe('')
  })

  it('lists one person\'s open waits, or everyone\'s', async () => {
    tables.action_queue = [wait(), wait({ id: 'w2', follow_up: { ...(wait().follow_up as Row), created_by: 'u1' } }), wait({ id: 'w3', status: 'done' })]
    expect((await listWaits(db, 't1', { userId: 'u2' })).map(c => c.id)).toEqual([wait().id])
    expect((await listWaits(db, 't1')).map(c => c.id)).toEqual([wait().id, 'w2'])
  })
})
