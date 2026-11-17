import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'

// The Job Details panel's Save: the session's tenant, permission jobs.edit,
// saved by saveJobEdit (the voice tools' code), logged when something changed.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables)
let me: { tenantId: string; userId: string } | null = { tenantId: 't1', userId: 'u1' }
let denied: Response | null = null
const recorded: unknown[] = []

vi.mock('@/lib/auth/session', () => ({ sessionUser: async () => me, unauthorized: () => new Response('{}', { status: 401 }) }))
vi.mock('@/lib/permissions/http', () => ({ permissionDenied: async () => denied }))
vi.mock('@/lib/activity/log', () => ({ recordOperation: async (p: unknown) => { recorded.push(p) } }))
vi.mock('@/lib/mail/sync', () => ({ mailDb: () => db }))

const { PATCH } = await import('../route')
const ID = '11111111-2222-3333-4444-555555555555'
const patch = (body: unknown, id = ID) => PATCH(new Request(`https://app.test/api/jobs/${id}/details`, { method: 'PATCH', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ jobId: id }) })

beforeEach(() => {
  me = { tenantId: 't1', userId: 'u1' }
  denied = null
  recorded.length = 0
  tables.jobs = [{ id: ID, tenant_id: 't1', job_number: 'IRC1080', claim_number: 'CL1', excess: 500, insured_name: 'Bruce', insured_phone: '0400', insured_email: null, contacts: [] }]
})

describe('PATCH /api/jobs/[jobId]/details', () => {
  it('saves the details and insured, and logs what changed', async () => {
    const res = await patch({ details: { claim_number: 'CL2', excess: '500' }, insured: { name: 'Bruce', phone: '0499', email: '' }, contacts: [] })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ job_number: 'IRC1080', changed: ['claim number', 'insured phone'] })
    expect(tables.jobs[0]).toMatchObject({ claim_number: 'CL2', excess: 500, insured_phone: '0499' })
    expect(recorded).toEqual([expect.objectContaining({ tenantId: 't1', userId: 'u1', action: 'jobs.edit', operation: 'job.edit' })])
  })

  it('refuses a bad value, no permission, no session or another company\'s job', async () => {
    expect((await patch({ details: { order_sender_email: 'nope' } })).status).toBe(400)
    denied = new Response('{}', { status: 403 })
    expect((await patch({ details: { claim_number: 'X' } })).status).toBe(403)
    denied = null
    me = { tenantId: 't2', userId: 'u1' }
    expect((await patch({ details: { claim_number: 'X' } })).status).toBe(404)
    me = null
    expect((await patch({ details: { claim_number: 'X' } })).status).toBe(401)
    expect(tables.jobs[0].claim_number).toBe('CL1')
    expect(recorded).toHaveLength(0)
  })
})
