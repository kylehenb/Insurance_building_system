import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from './fake-supabase'

// Finding a job from what's remembered about it (find_job), and a trade's,
// supplier's or insured's phone and email (find_contact): the trades
// directory, email history and signatures, and the mailbox when nothing on
// file has a number.

vi.mock('@/lib/jobs/fetchJobContext', () => ({ fetchJobContext: async () => ({}) }))
let mailAllowed = true
vi.mock('@/lib/permissions/resolve', () => ({ permissionLevel: async () => (mailAllowed ? 'allowed' : 'blocked'), refusalMessage: () => 'no' }))
const b64 = (s: string) => Buffer.from(s).toString('base64url')
const gmailMessages: Record<string, { from: string; text: string }> = {}
const list = vi.fn(async () => ({ data: { messages: Object.keys(gmailMessages).map(id => ({ id })) } }))
vi.mock('@/lib/gmail/client', () => ({
  getGmailClient: () => ({
    users: {
      messages: {
        list: (...a: unknown[]) => (list as (...x: unknown[]) => unknown)(...a),
        get: async ({ id }: { id: string }) => ({
          data: { id, internalDate: '1793404800000', payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: gmailMessages[id].from }], body: { data: b64(gmailMessages[id].text) } } },
        }),
      },
    },
  }),
}))

const { findJob } = await import('../tools/jobs')
const { findContact } = await import('../tools/contacts')
const { phonesInEmail } = await import('@/lib/contacts/search')

const db: Record<string, Row[]> = {}
const ctx = { supabase: fakeSupabase(db) as never, tenantId: 't1', userId: 'u1' }

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k]
  for (const k of Object.keys(gmailMessages)) delete gmailMessages[k]
  list.mockClear()
  mailAllowed = true
  db.clients = [{ id: 'c1', tenant_id: 't1', name: 'Castle Insurance' }, { id: 'c2', tenant_id: 't1', name: 'Allianz' }]
  db.jobs = [
    { id: 'j1', tenant_id: 't1', job_number: 'IRC1053', property_address: '9 Leighton Rd, Mundaring WA 6073', insured_name: 'Pat Brown', insurer: 'Castle', claim_number: 'CL-0098812', client_id: 'c1', current_stage: 'repairs_in_progress', created_at: '2026-09-01' },
    { id: 'j2', tenant_id: 't1', job_number: 'IRC1060', property_address: '14 Leighton St, Bassendean WA 6054', insured_name: 'Sam Leighton', insurer: 'Allianz', claim_number: 'AZ551', client_id: 'c2', current_stage: 'awaiting_schedule', created_at: '2026-10-01', insured_phone: '0412 555 101', insured_email: 'sam@l.com' },
    { id: 'jx', tenant_id: 'other', job_number: 'IRC9999', property_address: '1 Leighton Rd, Mundaring', insured_name: 'X', client_id: null },
  ]
  db.trades = [
    { id: 'tf', tenant_id: 't1', business_name: 'True Fix Carpentry', primary_contact: 'Dave', primary_trade: 'Carpenter', contact_email: 'jobs@truefix.com.au', contact_mobile: '0400 111 222', contact_office: null, status: 'active' },
    { id: 'tg', tenant_id: 't1', business_name: 'Glassworks WA', primary_trade: 'Glazier', contact_email: 'orders@glassworks.com.au', contact_mobile: null, contact_office: null, status: 'active' },
  ]
  db.work_orders = [{ id: 'w1', tenant_id: 't1', trade_id: 'tf', job_id: 'j1', created_at: '2026-09-10' }]
  db.communications = [
    { tenant_id: 't1', type: 'email', direction: 'inbound', from_email: 'orders@glassworks.com.au', to_email: 'office@irc.com.au', job_id: 'j2', created_at: '2026-10-02',
      body_text: 'Glass is in.\n\nRegards, Lisa\nGlassworks WA | (08) 9274 1234 | 0433 222 333\n\nOn Tue, IRC wrote:\n> call us on 08 6555 0000' },
  ]
  db.tenants = [{ id: 't1', contact_phone: '08 6555 0000', contact_email: 'office@irc.com.au' }]
})

describe('find_job', () => {
  it('finds a job by street and suburb, with its client, claim and stage', async () => {
    const res = await findJob.run({ query: 'Leighton Mundaring' }, ctx)
    expect(res.text).toBe('One job matches "Leighton Mundaring":\n- IRC1053: 9 Leighton Rd, Mundaring WA 6073, Pat Brown (Castle Insurance, claim CL-0098812) — Repairs In Progress.')
    expect((res.data!.jobs as Row[])[0]).toMatchObject({ job_number: 'IRC1053', client_name: 'Castle Insurance', claim_number: 'CL-0098812', matched_on: ['address'] })
  })

  it('finds by insured, client, claim or job number, and lists every match', async () => {
    const both = await findJob.run({ query: 'leighton' }, ctx)
    expect((both.data!.jobs as Row[]).map(j => j.job_number).sort()).toEqual(['IRC1053', 'IRC1060'])
    expect(both.text).toMatch(/^2 jobs match "leighton":/)
    expect((await findJob.run({ query: 'castle brown' }, ctx)).text).toContain('IRC1053')
    expect((await findJob.run({ query: 'claim CL0098812' }, ctx)).text).toContain('IRC1053')
    expect((await findJob.run({ query: 'irc 1060' }, ctx)).text).toContain('IRC1060: 14 Leighton St')
  })

  it('never crosses tenants, and says when nothing matches', async () => {
    expect((await findJob.run({ query: 'IRC9999' }, ctx)).text).toBe('No job matches "IRC9999". Try fewer words, or just the street or surname.')
    expect((await findJob.run({ query: '' }, ctx)).isError).toBe(true)
  })
})

describe('find_contact', () => {
  it('reads phone numbers from an email\'s own signature, not the email it quotes or our own number', () => {
    expect(phonesInEmail(db.communications[0].body_text as string, ['08 6555 0000'])).toEqual(['(08) 9274 1234', '0433 222 333'])
  })

  it('gives a trade\'s phone, email and jobs from the directory', async () => {
    const res = await findContact.run({ name: 'true fix' }, ctx)
    expect(res.text).toBe('Found "true fix":\n- True Fix Carpentry (Dave) — Carpenter: phone 0400 111 222; email jobs@truefix.com.au; jobs IRC1053. [trade directory]')
    expect(list).not.toHaveBeenCalled()
  })

  it('takes a number from their email signature when the directory has none', async () => {
    const res = await findContact.run({ name: 'Glassworks' }, ctx)
    expect(res.text).toContain('Glassworks WA — Glazier: phone (08) 9274 1234 (from their email signature), also 0433 222 333; email orders@glassworks.com.au; jobs IRC1060')
  })

  it('finds insureds on jobs', async () => {
    const res = await findContact.run({ name: 'Sam Leighton' }, ctx)
    expect(res.text).toContain('- Sam Leighton: phone 0412 555 101; email sam@l.com; jobs IRC1060. [insured on a job]')
  })

  it('searches the mailbox by sender when nothing on file has a number — only for someone who can see mail', async () => {
    gmailMessages.m1 = { from: 'Acme Timber Supplies <sales@acmetimber.com.au>', text: 'Order confirmed.\nAcme Timber | 1300 123 456' }
    const res = await findContact.run({ name: 'Acme Timber' }, ctx)
    expect(list).toHaveBeenCalledWith({ userId: 'me', q: 'from:"Acme Timber"', maxResults: 6 })
    expect(res.text).toContain('- Acme Timber Supplies: phone 1300 123 456 (from their email signature); email sales@acmetimber.com.au;')

    mailAllowed = false
    list.mockClear()
    expect((await findContact.run({ name: 'Acme Timber' }, ctx)).text).toMatch(/^No one called "Acme Timber"/)
    expect(list).not.toHaveBeenCalled()
  })
})
