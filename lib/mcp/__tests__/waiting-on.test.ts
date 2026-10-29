import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from './fake-supabase'

// "What am I waiting on?": the waits IRC set from emails the office sent
// that asked someone for something (lib/actions/waits.ts) — the user's own,
// or the whole office's; for one job or one person.

const tables: Record<string, Row[]> = {}
vi.mock('@/lib/mcp/tools/excess', () => ({
  isToolResult: (v: unknown) => !!v && typeof v === 'object' && 'text' in v,
  jobFromArgs: async (args: Row) => (args.job_number === 'IRC1001' ? { id: 'j1', job_number: 'IRC1001' } : { text: 'No job found.', isError: true }),
}))

const { listWaitingOn } = await import('../tools/follow-ups')
const ctx = (userId = 'u1') => ({ supabase: fakeSupabase(tables) as never, tenantId: 't1', userId })

const wait = (id: string, o: { name: string; asked: string; by: string; job?: string | null; status?: string; due?: string; behalf?: string | null }): Row => ({
  id, tenant_id: 't1', job_id: o.job ?? null, source: 'followup', rule_key: 'waiting_on', status: o.status ?? 'scheduled', title: `Waiting on ${o.name}`,
  due_at: o.due ?? '2099-11-02T00:00:00.000Z', steps: [],
  follow_up: {
    kind: 'waiting_on', note: '', who: o.name, thread_id: null, created_by: o.by, from_card_id: null,
    waiting: { name: o.name, email: `${o.name.split(' ')[0].toLowerCase()}@x.com.au`, role: 'trade', asked: o.asked, ask_kind: 'photos', on_behalf_of: o.behalf ?? null, message_id: 'm1', sent_at: '2099-10-29T02:00:00.000Z', ai_days: 2, ai_due_at: '2099-11-02T00:00:00.000Z', reason: 'Usually 2 days.', situation: {} },
  },
})

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  tables.jobs = [{ id: 'j1', tenant_id: 't1', job_number: 'IRC1001', insured_name: 'Casey' }]
  tables.users = [{ id: 'u1', tenant_id: 't1', name: 'Kyle' }, { id: 'u2', tenant_id: 't1', name: 'Sam' }]
  tables.action_queue = [
    wait('w1', { name: 'Sparky Bros', asked: 'the switchboard photos', by: 'u1', job: 'j1', behalf: 'Suncorp asked on 27 Oct' }),
    wait('w2', { name: 'Ace Roofing', asked: 'the roof quote', by: 'u1', status: 'pending', due: '2099-10-31T00:00:00.000Z' }),
    wait('w3', { name: 'Jo Allianz', asked: 'approval to proceed', by: 'u2' }),
    wait('w4', { name: 'Done Plumbing', asked: 'an invoice', by: 'u1', status: 'done' }),
    { id: 'f1', tenant_id: 't1', source: 'followup', rule_key: 'followup', status: 'scheduled', due_at: '2099-11-01T00:00:00.000Z', follow_up: { note: 'Call Jo', created_by: 'u1' } },
  ]
})

describe('list_waiting_on', () => {
  it('lists what the user is waiting on, soonest chase first, saying when a chase is already on the cards', async () => {
    const out = await listWaitingOn.run({}, ctx())
    expect(out.text).toBe([
      'You\'re waiting on 2 things:',
      '1. Ace Roofing — the roof quote (asked Thu 29 Oct; the chase is on the action cards now)',
      '2. Sparky Bros — the switchboard photos, IRC1001 (asked Thu 29 Oct; chase Mon 2 Nov). Suncorp asked on 27 Oct',
    ].join('\n'))
    expect((out.data!.waiting_on as Row[]).map(w => w.follow_up_id)).toEqual(['w2', 'w1'])
  })

  it('lists the whole office\'s with who each is for, and narrows to a job or a person', async () => {
    const all = await listWaitingOn.run({ everyone: true }, ctx())
    expect(all.text).toMatch(/^The office is waiting on 3 things:/)
    expect(all.text).toContain('Jo Allianz — approval to proceed (asked Thu 29 Oct; chase Mon 2 Nov) — for Sam')
    expect((await listWaitingOn.run({ job_number: 'IRC1001' }, ctx())).text).toMatch(/^You're waiting on 1 thing:\n1\. Sparky Bros/)
    expect((await listWaitingOn.run({ person: 'sparky' }, ctx())).text).toMatch(/^You're waiting on 1 thing:\n1\. Sparky Bros/)
  })

  it('says when there\'s nothing, and passes on an unknown job', async () => {
    expect((await listWaitingOn.run({ person: 'nobody' }, ctx('u2'))).text).toBe('You\'re not waiting on "nobody". (Say "everyone" for the whole office.)')
    expect(await listWaitingOn.run({ job_number: 'IRC9' }, ctx())).toMatchObject({ isError: true, text: 'No job found.' })
  })
})
