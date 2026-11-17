import { describe, it, expect, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'
import { saveJobEdit, settleContacts, updateJobContact } from '../details'
import type { JobContact } from '@/lib/types/contacts'

// The Job Details panel's Save (saveJobEdit) and the voice tools
// (updateJobContact) settle contacts the same way.

const tables: Record<string, Row[]> = {}
const db = () => fakeSupabase(tables) as never
const job = () => tables.jobs[0]
const insured = (roles: JobContact['roles']): JobContact => ({ slot: 'insured', name: 'Bruce', phone: '0400', email: '', roles })

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  tables.jobs = [{
    id: 'j1', tenant_id: 't1', job_number: 'IRC1080', insurer: 'Castle', client_id: 'c1', claim_number: 'CL1', notes: null,
    insured_name: 'Bruce', insured_phone: '0400', insured_email: null,
    contacts: [insured(['insured', 'auth', 'primary_site'])],
  }]
})

describe('saveJobEdit', () => {
  it('keeps the insured in step in both places', async () => {
    const out = await saveJobEdit(db(), 't1', 'j1', { insured: { name: 'Bruce Long', phone: '0499', email: 'B@X.com' }, contacts: [insured(['insured', 'auth', 'primary_site'])] })
    expect(out.changed).toEqual(['insured name', 'insured phone', 'insured email'])
    expect(job()).toMatchObject({ insured_name: 'Bruce Long', insured_phone: '0499', insured_email: 'b@x.com' })
    expect((job().contacts as JobContact[])[0]).toMatchObject({ name: 'Bruce Long', phone: '0499', email: 'b@x.com' })
  })

  it('saves panel-only fields and reports nothing when nothing changed', async () => {
    expect((await saveJobEdit(db(), 't1', 'j1', { details: { insurer: 'Castle', claim_number: 'CL1', notes: '' } })).changed).toEqual([])
    const out = await saveJobEdit(db(), 't1', 'j1', { details: { insurer: 'Allianz', client_id: 'c2', notes: 'Gate code 1234' } })
    expect(out.changed).toEqual(['insurer', 'insurer client', 'overview notes'])
    expect(out.saved).toMatchObject({ insurer: 'Allianz', client_id: 'c2', notes: 'Gate code 1234' })
  })

  it('gives a role to one contact only and back to the insured when no one has it', async () => {
    const tenant: JobContact = { slot: 'additional_1', type: 'tenant', name: 'Jane', phone: '1', email: '', roles: ['primary_site', 'auth'] }
    await saveJobEdit(db(), 't1', 'j1', { contacts: [insured(['insured', 'auth', 'primary_site']), tenant] })
    expect((job().contacts as JobContact[]).map(c => c.roles)).toEqual([['insured'], ['primary_site', 'auth']])
    await saveJobEdit(db(), 't1', 'j1', { contacts: [insured(['insured'])] })
    expect((job().contacts as JobContact[]).map(c => c.roles)).toEqual([['insured', 'auth', 'primary_site']])
  })

  it('refuses a bad email and saves nothing', async () => {
    await expect(saveJobEdit(db(), 't1', 'j1', { details: { claim_number: 'CL9' }, insured: { email: 'nope' } })).rejects.toThrow("isn't an email")
    expect(job().claim_number).toBe('CL1')
  })
})

it('the panel and voice end with the same contacts', async () => {
  await updateJobContact(db(), 't1', 'j1', { contact: 'new', type: 'tenant', name: 'Jane', phone: '1', roles: ['primary_site'] })
  const byVoice = JSON.stringify(job().contacts)
  beforeEachReset()
  const panel = settleContacts([insured(['insured', 'auth', 'primary_site']), { slot: 'additional_1', type: 'tenant', name: 'Jane', phone: '1', email: '', roles: ['primary_site'] }], 'additional_1')
  await saveJobEdit(db(), 't1', 'j1', { contacts: panel })
  expect(JSON.stringify(job().contacts)).toBe(byVoice)
})

function beforeEachReset() {
  tables.jobs[0].contacts = [insured(['insured', 'auth', 'primary_site'])]
}
