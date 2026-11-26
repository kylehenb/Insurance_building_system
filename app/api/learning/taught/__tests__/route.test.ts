import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'

// The Got it list's Reword and Remove: only lessons the office taught, the
// session's tenant, permission actions.review.

const tables: Record<string, Row[]> = {}
let denied: Response | null = null
vi.mock('@/lib/auth/session', () => ({ sessionUser: async () => ({ tenantId: 't1', userId: 'u1' }), unauthorized: () => new Response('{}', { status: 401 }) }))
vi.mock('@/lib/permissions/http', () => ({ permissionDenied: async () => denied }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => fakeSupabase(tables) }))
const { POST } = await import('../[id]/route')
const call = (id: string, body: unknown) => POST(new Request('https://x', { method: 'POST', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id }) })

beforeEach(() => {
  denied = null
  tables.learning_lessons = [
    { id: 'l1', tenant_id: 't1', lesson: 'Casual with Dave.', applies_when: 'Emails to Dave', source: 'taught', status: 'active' },
    { id: 'l2', tenant_id: 't1', lesson: 'Learned one.', applies_when: 'x', source: 'learned', status: 'active' },
  ]
})

describe('POST /api/learning/taught/[id]', () => {
  it('rewords and removes a taught lesson', async () => {
    expect((await call('l1', { lesson: 'Casual and short with Dave.' })).status).toBe(200)
    expect(tables.learning_lessons[0]).toMatchObject({ lesson: 'Casual and short with Dave.', applies_when: 'Emails to Dave' })
    expect((await call('l1', { remove: true })).status).toBe(200)
    expect(tables.learning_lessons[0]).toMatchObject({ status: 'retired' })
  })
  it('leaves learned lessons, and needs the permission', async () => {
    expect((await call('l2', { remove: true })).status).toBe(404)
    denied = new Response('{}', { status: 403 })
    expect((await call('l1', { remove: true })).status).toBe(403)
    expect(tables.learning_lessons.map(l => l.status)).toEqual(['active', 'active'])
  })
})
