import { describe, it, expect, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'
import { cleanupCandidates, closeJobs, CloseJobError, reopenJob } from '../close'

// The clean-up of old jobs: open jobs quiet for 90 days, each with the reason
// it most likely closed; closing by hand and reopening.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables) as never
const AT = new Date('2026-11-02T00:00:00Z')
const daysAgo = (n: number) => new Date(AT.getTime() - n * 86_400_000).toISOString()

const job = (id: string, extra: Row = {}): Row => ({
  id, tenant_id: 't1', job_number: id.toUpperCase(), property_address: `${id} St`, insurer: 'Castle',
  phase: 'awaiting_decision', phase_step: 'waiting_on_insurer', created_at: daysAgo(300), override_stage: null, closed_by_hand: null, ...extra,
})

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  tables.jobs = [
    job('irc1'), // quote sent long ago → no decision
    job('irc2'), // works invoiced → complete
    job('irc3'), // quote declined → declined
    job('irc4'), // never quoted → cancelled
    job('irc5'), // an email last month → not offered
    job('irc6', { phase: 'closed' }), // already closed
    job('irc7', { override_stage: 'on_hold' }), // on hold
    job('irc8', { created_at: daysAgo(10) }), // new
    job('irc9', { phase: null }), // not worked out yet → still offered
    job('other', { tenant_id: 't2' }), // another company
  ]
  tables.quotes = [
    { id: 'q1', tenant_id: 't1', job_id: 'irc1', status: 'sent', is_active_version: true, created_at: daysAgo(200) },
    { id: 'q3', tenant_id: 't1', job_id: 'irc3', status: 'rejected', is_active_version: true, created_at: daysAgo(150) },
    { id: 'q3old', tenant_id: 't1', job_id: 'irc3', status: 'sent', is_active_version: false, created_at: daysAgo(160) },
  ]
  tables.invoices = [
    { id: 'i2', tenant_id: 't1', job_id: 'irc2', invoice_type: 'main', status: 'sent', direction: 'outbound', created_at: daysAgo(120) },
    { id: 'i4', tenant_id: 't1', job_id: 'irc4', invoice_type: 'main', status: 'voided', direction: 'outbound', created_at: daysAgo(130) },
  ]
  tables.communications = [
    { id: 'c1', tenant_id: 't1', job_id: 'irc1', created_at: daysAgo(110) },
    { id: 'c5', tenant_id: 't1', job_id: 'irc5', created_at: daysAgo(30) },
  ]
  tables.action_queue = []
  tables.calendar_events = []
})

describe('cleanupCandidates', () => {
  it('offers open jobs quiet for 90 days with the likely reason, most recent first', async () => {
    const list = await cleanupCandidates(db, 't1', AT)
    expect(list.map(c => [c.job_number, c.suggested])).toEqual([
      ['IRC1', 'no_decision'],
      ['IRC2', 'complete'],
      ['IRC4', 'cancelled'],
      ['IRC3', 'declined'],
      ['IRC9', 'cancelled'],
    ])
    expect(list[0]).toMatchObject({ last_activity: daysAgo(110), why: 'The quote went to the insurer and no decision came' })
  })

  it('reads every page of a big table', async () => {
    tables.communications = Array.from({ length: 2500 }, (_, i) => ({ id: `c${String(i).padStart(5, '0')}`, tenant_id: 't1', job_id: i === 2400 ? 'irc4' : 'irc5', created_at: daysAgo(i === 2400 ? 5 : 30) }))
    const list = await cleanupCandidates(db, 't1', AT)
    expect(list.map(c => c.job_number)).not.toContain('IRC4')
  })
})

describe('closeJobs / reopenJob', () => {
  it('closes each job with its reason, only in the company', async () => {
    const closed = await closeJobs(db, 't1', [{ jobId: 'irc1', reason: 'no_decision' }, { jobId: 'irc4', reason: 'cancelled' }, { jobId: 'other', reason: 'complete' }])
    expect(closed).toEqual(['IRC1', 'IRC4'])
    expect(tables.jobs.find(j => j.id === 'irc1')!.closed_by_hand).toBe('no_decision')
    expect(tables.jobs.find(j => j.id === 'other')!.closed_by_hand).toBeNull()
  })

  it('refuses a bad reason or no jobs', async () => {
    await expect(closeJobs(db, 't1', [])).rejects.toBeInstanceOf(CloseJobError)
    await expect(closeJobs(db, 't1', [{ jobId: 'irc1', reason: 'done' as never }])).rejects.toThrow(/close reason/)
  })

  it('reopens a hand-closed job', async () => {
    tables.jobs[0].closed_by_hand = 'cancelled'
    expect(await reopenJob(db, 't1', 'irc1')).toBe('IRC1')
    expect(tables.jobs[0].closed_by_hand).toBeNull()
    await expect(reopenJob(db, 't1', 'other')).rejects.toThrow(/not found/)
  })
})
