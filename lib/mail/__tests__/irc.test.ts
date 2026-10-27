import { describe, it, expect } from 'vitest'
import { filingForThreads, filingOf } from '../filing'
import { listFolder } from '../list'
import { jobContacts } from '../job-context'

// Phase 5: where a conversation stands in IRC, and who to email about a job.

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

type Row = Record<string, unknown>
/** Enough of supabase-js for the filing and the mirror list: eq / in filters, the rest pass through */
function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(name: string) {
      const preds: ((r: Row) => boolean)[] = []
      let patch: Row | null = null
      const run = () => {
        const hit = (tables[name] ?? []).filter(r => preds.every(p => p(r)))
        if (patch) hit.forEach(r => Object.assign(r, patch))
        return { data: hit.map(r => ({ ...r })), error: null }
      }
      const b: Record<string, unknown> = {
        select: () => b, order: () => b, limit: () => b, not: () => b, contains: () => b, lt: () => b,
        update: (p: Row) => { patch = p; return b },
        eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
        in: (c: string, v: unknown[]) => { preds.push(r => v.includes(r[c])); return b },
        then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
      }
      return b
    },
  }
}

describe('a conversation\'s job', () => {
  const comm = (o: Row): Row => ({ tenant_id: 't1', job_id: null, source: null, direction: 'inbound', insurer_order_id: null, created_at: '2026-10-01', ...o })

  it('is the job its order was lodged as', async () => {
    const db = fakeDb({
      communications: [comm({ thread_id: 'th1', insurer_order_id: 'o1' }), comm({ thread_id: 'th2', insurer_order_id: 'o2' })],
      insurer_orders: [{ id: 'o1', tenant_id: 't1', job_id: 'j9' }, { id: 'o2', tenant_id: 't1', job_id: null }],
    })
    const out = await filingForThreads(db as never, 't1', ['th1', 'th2'])
    expect(out.get('th1')).toEqual({ filing: 'job', jobId: 'j9' })
    expect(out.get('th2')).toEqual({ filing: null, jobId: null })
  })

  it('is filled in on the list when the mirror is behind its filed emails, and the mirror is put right', async () => {
    const mirror: Row = {
      mailbox_id: 'mb1', tenant_id: 't1', gmail_thread_id: 'th1', subject: 'Cabinets', snippet: '', participants: [], recipients: [],
      last_message_at: '2026-10-02', message_count: 1, label_ids: ['INBOX'], unread: false, has_attachments: false, filing: 'to_file', job_id: null,
    }
    const db = fakeDb({
      mail_threads: [mirror],
      communications: [comm({ thread_id: 'th1', job_id: 'j1' })],
      jobs: [{ id: 'j1', tenant_id: 't1', job_number: 'IRC1053', insured_name: 'Brown' }],
    })
    const page = await listFolder({ id: 'mb1', tenant_id: 't1' } as never, 'inbox', null, null, db as never)
    expect(page.threads[0]).toMatchObject({ job: { job_number: 'IRC1053' }, filing: 'job' })
    expect(mirror).toMatchObject({ job_id: 'j1', filing: 'job' })
  })
})
