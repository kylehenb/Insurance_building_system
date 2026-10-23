import { describe, it, expect, vi, beforeEach } from 'vitest'

// The stage change must use the signed-in user's tenant, never one from the
// request body.

const eqCalls: [string, unknown][] = []
let sessionTenant: string | null = 't1'
// Permissions are tested in lib/permissions; here the user is allowed
vi.mock('@/lib/permissions/http', () => ({ permissionDenied: async () => null, permissionGate: async () => null }))
vi.mock('@/lib/supabase/get-user', () => ({ getUser: async () => (sessionTenant ? { tenant_id: sessionTenant } : null) }))
const client = {
  from: () => {
    const b = {
      update: () => b,
      eq: (c: string, v: unknown) => { eqCalls.push([c, v]); return b },
      then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
    }
    return b
  },
}
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => client, createServiceClient: () => client }))

const { PATCH } = await import('../route')
const patch = (body: unknown) =>
  PATCH(new Request('https://app.test/api/jobs/j1/stage', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ jobId: 'j1' }) })

beforeEach(() => { eqCalls.length = 0; sessionTenant = 't1' })

describe('PATCH /api/jobs/[jobId]/stage', () => {
  it('uses the session tenant and ignores one in the body', async () => {
    const res = await patch({ tenantId: 'someone-else', stage: 'works_in_progress' })
    expect(res.status).toBe(200)
    expect(eqCalls).toContainEqual(['tenant_id', 't1'])
    expect(eqCalls).not.toContainEqual(['tenant_id', 'someone-else'])
  })

  it('refuses without a signed-in user', async () => {
    sessionTenant = null
    expect((await patch({ stage: 'works_in_progress' })).status).toBe(401)
    expect(eqCalls).toHaveLength(0)
  })
})
