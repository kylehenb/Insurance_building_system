import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/midcity/work-order: from the app (signed in) or the iPhone
// Shortcut (a personal voice key), checks orders.lodge, and answers with the
// field app link the Shortcut opens.

let me: { tenantId: string; userId: string } | null = null
let keyOwner: { id: string; tenantId: string; userId: string } | null = null
let denied: Response | null = null
const made: Array<Record<string, unknown>> = []
const logged: Array<Record<string, unknown>> = []

vi.mock('@/lib/auth/session', () => ({ sessionUser: async () => me }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/voice-keys/keys', () => ({ VOICE_KEY_PREFIX: 'irc_vk_', findVoiceKey: async () => keyOwner }))
vi.mock('@/lib/mcp/auth', () => ({ keyFromAuthorization: (h: string | null) => (h ?? '').replace(/^Bearer\s*/i, '') }))
vi.mock('@/lib/permissions/http', () => ({ permissionDenied: async () => denied }))
vi.mock('@/lib/activity/log', () => ({ recordActivity: async (e: Record<string, unknown>) => { logged.push(e) } }))
vi.mock('@/lib/jobs/field-work-order', () => ({
  createJobFromWorkOrder: async (_s: unknown, p: Record<string, unknown>) => {
    made.push(p)
    return { jobId: 'j1', inspectionId: 'i1', jobNumber: 'WO-1', existing: false, details: { address: '1 Main St' } }
  },
}))

const route = await import('../work-order/route')
const { NextRequest } = await import('next/server')

function send(body: BodyInit, headers: Record<string, string> = {}) {
  return route.POST(new NextRequest('https://app.test/api/midcity/work-order', { method: 'POST', body, headers }))
}
const pdfForm = () => {
  const fd = new FormData()
  fd.append('file', new File(['%PDF-1.7'], 'wo.pdf', { type: 'application/pdf' }))
  return fd
}

beforeEach(() => { me = null; keyOwner = null; denied = null; made.length = 0; logged.length = 0 })

describe('POST /api/midcity/work-order', () => {
  it('refuses without a session or a known key', async () => {
    expect((await send(pdfForm())).status).toBe(401)
    expect((await send(pdfForm(), { authorization: 'Bearer irc_vk_wrong' })).status).toBe(401)
    expect(made).toHaveLength(0)
  })

  it('from the Shortcut: acts as the key owner and answers with the link to open', async () => {
    keyOwner = { id: 'k1', tenantId: 't1', userId: 'u1' }
    const res = await send(pdfForm(), { authorization: 'Bearer irc_vk_abc' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ inspectionId: 'i1', url: 'https://app.test/midcity/field/i1' })
    expect(made[0]).toMatchObject({ tenantId: 't1', userId: 'u1', file: { mimeType: 'application/pdf', fileName: 'wo.pdf' } })
    expect(logged[0]).toMatchObject({ action: 'orders.lodge', jobId: 'j1', via: 'voice', voiceKeyId: 'k1' })
  })

  it('takes a raw PDF body too, telling it by its first bytes', async () => {
    me = { tenantId: 't1', userId: 'u1' }
    expect((await send(new TextEncoder().encode('%PDF-1.4 x'), { 'content-type': 'application/octet-stream' })).status).toBe(200)
    expect(made[0]).toMatchObject({ file: { mimeType: 'application/pdf' } })
  })

  it('checks orders.lodge before reading anything', async () => {
    me = { tenantId: 't1', userId: 'u1' }
    denied = new Response('{"error":"no"}', { status: 403 })
    expect((await send(pdfForm())).status).toBe(403)
    expect(made).toHaveLength(0)
  })
})
