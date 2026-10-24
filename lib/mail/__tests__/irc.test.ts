import { describe, it, expect } from 'vitest'
import { filingOf } from '../filing'
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
