import { describe, it, expect, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from './fake-supabase'
import { updateJobContactTool, updateJobDetailsTool } from '@/lib/mcp/tools/job-details'
import { MCP_TOOLS } from '@/lib/mcp/tools'

// Changing a job's details and contacts by voice: updateJobDetails /
// updateJobContact (lib/jobs/details.ts), the fields of the job's Job Details panel.

const tables: Record<string, Row[]> = {}
const ctx = () => ({ supabase: fakeSupabase(tables) as never, tenantId: 't1', userId: 'u1' }) as never
const job = () => tables.jobs[0]
type C = { slot: string; name: string; phone: string; email: string; roles: string[]; type?: string }
const stored = () => job().contacts as C[]

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  tables.jobs = [
    {
      id: 'j1', tenant_id: 't1', job_number: 'IRC1080', insurer: 'Castle', property_address: '5 Smith St',
      claim_number: 'CL1', loss_type: 'Storm or Rainwater', date_of_loss: '2026-10-01', excess: 500, sum_insured: null,
      adjuster: null, special_instructions: null,
      insured_name: 'Bruce Long', insured_phone: '0400 111 222', insured_email: 'bruce@x.com', contacts: [],
    },
    { id: 'j2', tenant_id: 't1', job_number: 'MC100', insurer: 'Midcity', property_address: '1 Rd', contacts: [] },
  ]
})

describe('update_job_details', () => {
  it('changes only what differs and says from and to', async () => {
    const res = await updateJobDetailsTool.run({ job_number: 'irc1080', claim_number: 'CL2', excess: 750, loss_type: 'Storm or Rainwater', date_of_loss: '2026-10-02' }, ctx())
    expect(res.text).toBe('Updated IRC1080, 5 Smith St: claim number from "CL1" to "CL2"; date of loss from "2026-10-01" to "2026-10-02"; excess from $500 to $750.')
    expect(job()).toMatchObject({ claim_number: 'CL2', excess: 750, date_of_loss: '2026-10-02' })
  })

  it('clears a field', async () => {
    await updateJobDetailsTool.run({ job_number: 'IRC1080', clear: ['claim_number'] }, ctx())
    expect(job().claim_number).toBeNull()
  })

  it('refuses a bad value and saves nothing', async () => {
    const res = await updateJobDetailsTool.run({ job_number: 'IRC1080', claim_number: 'CL9', date_of_loss: 'last Tuesday' }, ctx())
    expect(res).toMatchObject({ isError: true, text: 'The date of loss must be a date like 2026-11-03' })
    expect(job().claim_number).toBe('CL1')
  })

  it('says when nothing changes, and leaves Midcity jobs alone', async () => {
    expect((await updateJobDetailsTool.run({ job_number: 'IRC1080', claim_number: 'CL1' }, ctx())).text).toMatch(/^Nothing to change/)
    expect((await updateJobDetailsTool.run({ job_number: 'MC100', claim_number: 'X' }, ctx())).isError).toBe(true)
    expect((await updateJobDetailsTool.run({ job_number: 'IRC1080' }, ctx())).isError).toBe(true)
  })
})

describe('update_job_contact', () => {
  it("changes the insured's phone on the job and in its contacts", async () => {
    tables.jobs[0].contacts = [{ slot: 'insured', name: 'Bruce Long', phone: '0400 111 222', email: 'bruce@x.com', roles: ['insured', 'auth', 'primary_site'] }]
    const res = await updateJobContactTool.run({ job_number: 'IRC1080', contact: 'insured', phone: '0499 999 000' }, ctx())
    expect(res.text.split('\n')[0]).toBe('Updated on IRC1080, 5 Smith St: Bruce Long (insured) — phone 0499 999 000, email bruce@x.com; authorises the work, main site contact.')
    expect(job().insured_phone).toBe('0499 999 000')
    expect(stored()[0].phone).toBe('0499 999 000')
  })

  it('adds a tenant who takes over as the main site contact', async () => {
    const res = await updateJobContactTool.run({ job_number: 'IRC1080', contact: 'new', type: 'tenant', name: 'Jane Brown', phone: '0412 345 678', roles: ['primary_site'] }, ctx())
    expect(res.isError).toBeFalsy()
    const insured = stored().find(c => c.slot === 'insured')!
    const tenant = stored().find(c => c.slot === 'additional_1')!
    expect(tenant).toMatchObject({ type: 'tenant', name: 'Jane Brown', roles: ['primary_site'] })
    expect(insured.roles).toEqual(['insured', 'auth'])
  })

  it('removes an additional contact and hands their roles back to the insured', async () => {
    tables.jobs[0].contacts = [
      { slot: 'insured', name: 'Bruce Long', phone: '', email: '', roles: ['insured', 'auth'] },
      { slot: 'additional_1', type: 'tenant', name: 'Jane', phone: '1', email: '', roles: ['primary_site'] },
    ]
    const res = await updateJobContactTool.run({ job_number: 'IRC1080', contact: 'additional_1', remove: true }, ctx())
    expect(res.text.split('\n')[0]).toBe('Removed Jane from IRC1080.')
    expect(stored()).toHaveLength(1)
    expect(stored()[0].roles).toEqual(['insured', 'auth', 'primary_site'])
  })

  it('refuses a bad email, a missing contact and an empty change', async () => {
    expect((await updateJobContactTool.run({ job_number: 'IRC1080', contact: 'insured', email: 'not an email' }, ctx())).isError).toBe(true)
    expect((await updateJobContactTool.run({ job_number: 'IRC1080', contact: 'additional_2', phone: '1' }, ctx())).isError).toBe(true)
    expect((await updateJobContactTool.run({ job_number: 'IRC1080', contact: 'insured' }, ctx())).isError).toBe(true)
    expect(job().insured_email).toBe('bruce@x.com')
  })
})

it('both tools are offered and need jobs.edit', () => {
  for (const name of ['update_job_details', 'update_job_contact']) {
    expect(MCP_TOOLS.find(t => t.name === name)?.permission).toBe('jobs.edit')
  }
})
