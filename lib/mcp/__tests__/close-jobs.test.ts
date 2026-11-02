import { describe, it, expect, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from './fake-supabase'
import { closeJobTool, reopenJobTool } from '@/lib/mcp/tools/close-jobs'

// Closing a job by hand and reopening it, by voice: the same closeJobs /
// reopenJob as Jobs → Close Old Jobs.

const tables: Record<string, Row[]> = {}
const ctx = () => ({ supabase: fakeSupabase(tables) as never, tenantId: 't1', userId: 'u1' }) as never

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  tables.jobs = [
    { id: 'j1', tenant_id: 't1', job_number: 'IRC1074', property_address: '5 Smith St', insured_name: 'A', closed_by_hand: null },
    { id: 'j2', tenant_id: 't1', job_number: 'IRC1075', property_address: '7 Jones Rd', insured_name: 'B', closed_by_hand: 'cancelled' },
  ]
})

describe('close_job', () => {
  it('closes a job with its reason', async () => {
    const res = await closeJobTool.run({ job_number: 'irc1074', reason: 'cancelled' }, ctx())
    expect(res.text).toBe('Closed IRC1074, 5 Smith St, as cancelled.')
    expect(tables.jobs[0].closed_by_hand).toBe('cancelled')
  })

  it('refuses a bad reason or an unknown job', async () => {
    expect((await closeJobTool.run({ job_number: 'IRC1074', reason: 'finished' }, ctx())).isError).toBe(true)
    expect((await closeJobTool.run({ job_number: 'IRC9999', reason: 'complete' }, ctx())).isError).toBe(true)
    expect(tables.jobs[0].closed_by_hand).toBeNull()
  })
})

describe('reopen_job', () => {
  it('reopens a hand-closed job', async () => {
    const res = await reopenJobTool.run({ job_number: 'IRC1075' }, ctx())
    expect(res.text).toBe('Reopened IRC1075, 7 Jones Rd.')
    expect(tables.jobs[1].closed_by_hand).toBeNull()
  })

  it("won't reopen a job that wasn't closed by hand", async () => {
    const res = await reopenJobTool.run({ job_number: 'IRC1074' }, ctx())
    expect(res).toMatchObject({ isError: true, text: "IRC1074 wasn't closed by hand, so there's nothing to reopen." })
  })
})
