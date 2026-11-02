import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'

// The daily job review: only jobs that changed since they were last read (or
// a week ago) are read, up to the day's limit; each gets a line on where it
// stands and at most two dated checks — none that double up, none while three
// of IRC's are open — and IRC's own checks it no longer needs are cancelled.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables) as never
vi.mock('@/lib/mcp/tools/jobs', () => ({ getJobSummary: { run: async () => ({ text: 'IRC1033 — painter booked for Sat 31 Oct; invoice $30,000 ready once painting done.' }) } }))

const { jobsToReview, reviewJob, cleanUp } = await import('../review')

// Mon 2 Nov 2026, 6:37am Perth
const MON = new Date('2026-11-01T22:37:00Z')

function model(input: Row) {
  const create = vi.fn(async () => ({ content: [{ type: 'tool_use', id: 't', name: 'review_job', input }] }))
  return { client: { beta: { messages: { create } } } as never, create }
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  tables.users = [{ id: 'admin1', tenant_id: 't1', role: 'admin', name: 'Kyle' }]
  tables.jobs = [
    { id: 'j33', tenant_id: 't1', job_number: 'IRC1033', created_at: '2026-09-01T00:00:00Z', reviewed_at: null, assigned_to: null },
    { id: 'j40', tenant_id: 't1', job_number: 'IRC1040', created_at: '2026-10-20T00:00:00Z', reviewed_at: '2026-10-31T22:37:00Z' },
    { id: 'j41', tenant_id: 't1', job_number: 'IRC1041', created_at: '2026-10-20T00:00:00Z', reviewed_at: '2026-10-31T22:37:00Z' },
    { id: 'j42', tenant_id: 't1', job_number: 'IRC1042', created_at: '2026-10-01T00:00:00Z', reviewed_at: '2026-10-20T00:00:00Z' },
    { id: 'j10', tenant_id: 't1', job_number: 'IRC1010', created_at: '2026-01-01T00:00:00Z', reviewed_at: null },
  ]
  tables.communications = [
    { tenant_id: 't1', job_id: 'j33', created_at: '2026-10-28T00:00:00Z' },
    { tenant_id: 't1', job_id: 'j40', created_at: '2026-11-01T05:00:00Z' }, // changed since read
    { tenant_id: 't1', job_id: 'j42', created_at: '2026-10-19T00:00:00Z' }, // quiet, read 13 days ago
  ]
})

describe('which jobs are read', () => {
  it('reads the never-read and the changed, and weekly the quiet; not the unchanged or the long-closed', async () => {
    expect((await jobsToReview(db, 't1', 10, MON)).map(j => j.job_number)).toEqual(['IRC1033', 'IRC1042', 'IRC1040'])
    expect((await jobsToReview(db, 't1', 1, MON)).map(j => j.job_number)).toEqual(['IRC1033'])
  })
})

describe('reviewing a job', () => {
  // Checks must be in the future: read as if it's that Monday morning
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(MON) })
  afterEach(() => { vi.useRealTimers() })

  it('notes where it stands and plans its checks, for the job\'s owner', async () => {
    const { client, create } = model({
      state: 'Painting due Sat 31 Oct; $30,000 invoice waiting on it',
      checks: [
        { when: '2026-11-02', what: 'Did the painter go on Saturday? If so, close the job and invoice.', who: 'Great Lengths Painting', why: 'Painter was due Saturday' },
        { when: '2026-11-09', what: 'Second', why: 'x' },
        { when: '2026-11-10', what: 'Third — over the limit', why: 'x' },
      ],
    })
    const out = await reviewJob(db, 't1', tables.jobs[0] as never, { client, at: MON })
    expect(out).toMatchObject({ job: 'IRC1033', state: 'Painting due Sat 31 Oct; $30,000 invoice waiting on it', cancelled: 0 })
    expect(out.checks).toEqual(['Mon 2 Nov: Did the painter go on Saturday? If so, close the job and invoice.', 'Mon 9 Nov: Second'])
    expect(tables.action_queue).toHaveLength(2)
    expect(tables.action_queue[0]).toMatchObject({
      source: 'followup', rule_key: 'job_watch', status: 'scheduled', job_id: 'j33', due_at: '2026-11-02T00:00:00.000Z',
      title: 'Check: Did the painter go on Saturday? If so, close the job and invoice.',
      follow_up: { kind: 'watch', who: 'Great Lengths Painting', created_by: 'admin1', watch: { why: 'Painter was due Saturday' } },
    })
    expect(tables.jobs[0]).toMatchObject({ reviewed_at: MON.toISOString(), review_note: 'Painting due Sat 31 Oct; $30,000 invoice waiting on it' })
    expect((create.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0].content).toContain('painter booked for Sat 31 Oct')
  })

  it('cancels its own checks no longer needed, and adds none while three are open', async () => {
    const watch = (id: string): Row => ({ id, tenant_id: 't1', job_id: 'j33', source: 'followup', rule_key: 'job_watch', status: 'scheduled', title: `Check ${id}`, due_at: '2099-01-01T00:00:00Z', steps: [], follow_up: { kind: 'watch', note: id } })
    tables.action_queue = [watch('w1'), watch('w2'), watch('w3'), { id: 'f1', tenant_id: 't1', job_id: 'j33', source: 'followup', status: 'scheduled', title: 'Mine', steps: [], follow_up: { note: 'mine' } }]
    const { client, create } = model({ state: 's', checks: [{ when: 'now', what: 'New', why: 'x' }], cancel: ['f1'] })
    const out = await reviewJob(db, 't1', tables.jobs[0] as never, { client, at: MON })
    expect(out).toMatchObject({ checks: [], cancelled: 0 }) // the office's own follow-up can't be cancelled; three of IRC's are open
    const prompt = (create.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0].content
    expect(prompt).toContain('- check w1: Check w1 (due ')
    expect(prompt).toContain('- follow-up f1: Mine')

    const again = model({ state: 's', checks: [{ when: 'now', what: 'Chase it today', why: 'KPI overdue' }], cancel: ['w1'] })
    const out2 = await reviewJob(db, 't1', tables.jobs[0] as never, { client: again.client, at: MON })
    expect(out2.cancelled).toBe(1)
    expect(tables.action_queue.find(r => r.id === 'w1')!.status).toBe('skipped')
    expect(tables.action_queue.at(-1)).toMatchObject({ title: 'Check: Chase it today', due_at: new Date(MON.getTime() + 120_000).toISOString() })
  })

  it('leaves the job to be read next time when it fails', async () => {
    const client = { beta: { messages: { create: vi.fn(async () => { throw new Error('overloaded') }) } } } as never
    expect(await reviewJob(db, 't1', tables.jobs[0] as never, { client, at: MON })).toMatchObject({ error: 'overloaded' })
    expect(tables.jobs[0].reviewed_at).toBeNull()
  })
})

describe('clean-up', () => {
  it('lets go of old calendar events and old finished sent-email reads, and nothing newer', async () => {
    tables.calendar_events = [{ id: 'old', end_at: '2026-06-01T00:00:00Z' }, { id: 'recent', end_at: '2026-10-01T00:00:00Z' }]
    tables.sent_emails = [{ id: 's1', status: 'done', updated_at: '2026-08-01T00:00:00Z' }, { id: 's2', status: 'new', updated_at: '2026-08-01T00:00:00Z' }, { id: 's3', status: 'done', updated_at: '2026-10-30T00:00:00Z' }]
    await cleanUp(db, MON)
    expect(tables.calendar_events.map(e => e.id)).toEqual(['recent'])
    expect(tables.sent_emails.map(e => e.id)).toEqual(['s2', 's3'])
  })
})
