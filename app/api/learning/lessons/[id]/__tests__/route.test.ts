import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'

// Turning a lesson off: the session's tenant, permission settings.edit, logged.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables)
let me: { tenantId: string; userId: string } | null = { tenantId: 't1', userId: 'u1' }
let denied: Response | null = null
const recorded: unknown[] = []

vi.mock('@/lib/auth/session', () => ({ sessionUser: async () => me, unauthorized: () => new Response('{}', { status: 401 }) }))
vi.mock('@/lib/permissions/http', () => ({ permissionDenied: async () => denied }))
vi.mock('@/lib/activity/log', () => ({ recordOperation: async (p: unknown) => { recorded.push(p) } }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => db, createClient: async () => db }))

const { POST } = await import('../route')
const ID = '11111111-2222-3333-4444-555555555555'
const post = (body: unknown, id = ID) => POST(new Request(`https://app.test/api/learning/lessons/${id}`, { method: 'POST', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id }) })

beforeEach(() => {
  me = { tenantId: 't1', userId: 'u1' }
  denied = null
  recorded.length = 0
  tables.users = [{ id: 'u1', tenant_id: 't1', name: 'Kyle' }]
  tables.learning_lessons = [{ id: ID, tenant_id: 't1', feature: 'action_card', applies_when: 'a', lesson: 'A', status: 'active', support_count: 2, contradict_count: 0 }]
})

describe('POST /api/learning/lessons/[id]', () => {
  it('turns the lesson off as the signed-in user, and logs it', async () => {
    const res = await post({ active: false })
    expect(res.status).toBe(200)
    expect(tables.learning_lessons[0]).toMatchObject({ status: 'retired', retired_reason: 'Turned off by Kyle' })
    expect(recorded).toEqual([expect.objectContaining({ tenantId: 't1', userId: 'u1', action: 'settings.edit', operation: 'lesson.status', payload: { lessonId: ID, active: false } })])
  })

  it('refuses without permission, without a session, or without a clear on/off', async () => {
    denied = new Response('{}', { status: 403 })
    expect((await post({ active: false })).status).toBe(403)
    denied = null
    expect((await post({ active: 'no' })).status).toBe(400)
    expect((await post({ active: false }, 'nope')).status).toBe(400)
    me = null
    expect((await post({ active: false })).status).toBe(401)
    expect(tables.learning_lessons[0].status).toBe('active')
    expect(recorded).toHaveLength(0)
  })

  it('says so when the lesson is another company\'s', async () => {
    me = { tenantId: 't2', userId: 'u1' }
    expect((await post({ active: false })).status).toBe(404)
    expect(tables.learning_lessons[0].status).toBe('active')
  })
})
