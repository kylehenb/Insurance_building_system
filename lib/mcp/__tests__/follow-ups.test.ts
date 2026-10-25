import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from './fake-supabase'

// Follow-up tools: set one from what the user said (on a job, about an
// email), list what's coming up, and move or cancel one — the Remind me
// button's own functions (lib/actions/followups.ts).

const tables: Record<string, Row[]> = {}
vi.mock('@/lib/mcp/tools/excess', () => ({
  isToolResult: (v: unknown) => !!v && typeof v === 'object' && 'text' in v,
  jobFromArgs: async (args: Row) => (args.job_number === 'IRC1001' ? { id: 'j1', job_number: 'IRC1001' } : { text: 'No job found.', isError: true }),
}))

const { setFollowUp, listFollowUps, changeFollowUp } = await import('../tools/follow-ups')
const ctx = () => ({ supabase: fakeSupabase(tables) as never, tenantId: 't1', userId: 'u1' })

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  tables.jobs = [{ id: 'j1', tenant_id: 't1', job_number: 'IRC1001', insured_name: 'Casey' }]
})

describe('set_follow_up', () => {
  it('sets a follow-up on a job, about an email', async () => {
    const out = await setFollowUp.run({ note: 'Chase the roof quote', when: '7', who: 'Ace Roofing', job_number: 'IRC1001', conversation_id: 'abc1' }, ctx())
    expect(out.isError).toBeUndefined()
    expect(out.text).toMatch(/^Follow-up set for \w{3} \d+ \w{3} on IRC1001: Chase the roof quote\. It'll come onto the action cards then\.$/)
    expect(tables.action_queue[0]).toMatchObject({ source: 'followup', status: 'scheduled', job_id: 'j1', follow_up: { who: 'Ace Roofing', thread_id: 'abc1', created_by: 'u1' } })
  })

  it('asks when, and passes on an unknown job', async () => {
    expect(await setFollowUp.run({ note: 'x', when: 'soonish' }, ctx())).toMatchObject({ isError: true, text: expect.stringMatching(/^When should it be\?/) })
    expect(await setFollowUp.run({ note: 'x', when: '3', job_number: 'IRC9' }, ctx())).toMatchObject({ isError: true, text: 'No job found.' })
    expect(tables.action_queue ?? []).toHaveLength(0)
  })
})

describe('list_follow_ups and change_follow_up', () => {
  it('lists what\'s coming up, moves one and cancels it', async () => {
    await setFollowUp.run({ note: 'Call Jo', when: '14', job_number: 'IRC1001' }, ctx())
    await setFollowUp.run({ note: 'Chase quote', when: '3', who: 'Ace Roofing' }, ctx())
    tables.action_queue.forEach((r, i) => { r.id = `00000000-0000-0000-0000-00000000000${i}` })
    const list = await listFollowUps.run({}, ctx())
    expect(list.text).toMatch(/^2 follow-ups coming up:\n1\. .*: Chase quote \(with Ace Roofing\)\n2\. .*: Call Jo — IRC1001$/)
    expect((await listFollowUps.run({ job_number: 'IRC1001' }, ctx())).text).toMatch(/^1 follow-up coming up/)

    const id = (list.data!.follow_ups as { follow_up_id: string }[])[0].follow_up_id
    expect((await changeFollowUp.run({ follow_up_id: id, when: '2099-01-05' }, ctx())).text).toMatch(/^Follow-up now Mon 5 Jan: Chase quote/)
    expect((await changeFollowUp.run({ follow_up_id: id, cancel: true }, ctx())).text).toBe('Follow-up cancelled.')
    expect((await changeFollowUp.run({ follow_up_id: id, cancel: true }, ctx())).isError).toBe(true)
  })
})
