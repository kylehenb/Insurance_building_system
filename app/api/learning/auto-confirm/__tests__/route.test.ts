import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'

// Turning auto-confirm on or off: the session's tenant and user, permission
// settings.edit, known kinds only, logged; "Not now" isn't logged.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables)
let me: { tenantId: string; userId: string } | null = { tenantId: 't1', userId: 'u1' }
let denied: Response | null = null
const recorded: unknown[] = []

vi.mock('@/lib/auth/session', () => ({ sessionUser: async () => me, unauthorized: () => new Response('{}', { status: 401 }) }))
vi.mock('@/lib/permissions/http', () => ({ permissionDenied: async () => denied }))
vi.mock('@/lib/permissions/resolve', () => ({ permissionLevel: async () => 'allowed' }))
vi.mock('@/lib/activity/log', () => ({ recordOperation: async (p: unknown) => { recorded.push(p) } }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => db, createClient: async () => db }))
vi.mock('@/lib/mail/sync', () => ({ mailDb: () => db, getMailbox: async () => ({ id: 'mb1' }) }))
vi.mock('@/lib/mcp/tools', () => ({ MCP_TOOLS: [] }))

const { GET, POST } = await import('../route')
const post = (body: unknown) => POST(new Request('https://app.test/api/learning/auto-confirm', { method: 'POST', body: JSON.stringify(body) }) as never)

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  me = { tenantId: 't1', userId: 'u1' }
  denied = null
  recorded.length = 0
  tables.users = [{ id: 'u1', tenant_id: 't1', name: 'Kyle' }]
})

describe('/api/learning/auto-confirm', () => {
  it('turns a kind on as the signed-in user, logged, and shows who', async () => {
    expect((await post({ feature: 'action_card', kind: 'invoice', enabled: true })).status).toBe(200)
    expect(tables.learning_auto_confirm[0]).toMatchObject({ tenant_id: 't1', kind: 'invoice', enabled: true, changed_by: 'u1' })
    expect(recorded).toEqual([expect.objectContaining({ action: 'settings.edit', operation: 'auto_confirm.set', payload: { feature: 'action_card', kind: 'invoice', enabled: true } })])
    const body = await (await GET()).json()
    expect(body.state.find((s: Row) => s.kind === 'invoice')).toMatchObject({ enabled: true, changed_by_name: 'Kyle' })
    expect(body.state.map((s: Row) => s.kind)).toEqual(['invoice', 'attend_submit', 'other'])
  })

  it('"Not now" is saved but not logged', async () => {
    expect((await post({ feature: 'action_card', kind: 'other', dismiss: true })).status).toBe(200)
    expect(tables.learning_auto_confirm[0]).toMatchObject({ kind: 'other', enabled: false })
    expect(recorded).toHaveLength(0)
  })

  it('refuses unknown kinds, unclear requests, no permission and no session', async () => {
    expect((await post({ feature: 'action_card', kind: 'everything', enabled: true })).status).toBe(400)
    expect((await post({ feature: 'report', kind: 'invoice', enabled: true })).status).toBe(400)
    expect((await post({ feature: 'action_card', kind: 'invoice' })).status).toBe(400)
    denied = new Response('{}', { status: 403 })
    expect((await post({ feature: 'action_card', kind: 'invoice', enabled: true })).status).toBe(403)
    me = null
    expect((await post({ feature: 'action_card', kind: 'invoice', enabled: true })).status).toBe(401)
    expect(tables.learning_auto_confirm ?? []).toHaveLength(0)
  })
})
