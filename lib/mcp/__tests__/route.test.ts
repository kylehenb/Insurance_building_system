import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// The connector URL's secret is the only thing standing between the internet
// and the app's data: anything but the exact secret must look like a 404.

const SECRET = 'a'.repeat(40)
const users = [{ id: 'u1', tenant_id: 't1' }]
const client = {
  from: () => {
    let id: unknown
    const b = {
      select: () => b,
      eq: (_c: string, v: unknown) => { id = v; return b },
      maybeSingle: async () => ({ data: users.find(u => u.id === id) ?? null, error: null }),
    }
    return b
  },
}
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => client }))

const { POST, GET } = await import('@/app/api/mcp/[secret]/route')
const { mcpContextFor } = await import('../auth')

const post = (secret: string, body: unknown) =>
  POST(new NextRequest(`https://app.test/api/mcp/${secret}`, { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ secret }) })

beforeEach(() => {
  vi.stubEnv('MCP_CONNECTOR_SECRET', SECRET)
  vi.stubEnv('MCP_USER_ID', 'u1')
})

describe('mcp auth', () => {
  it('accepts only the exact secret, and resolves the tenant from MCP_USER_ID', async () => {
    expect(await mcpContextFor(SECRET)).toMatchObject({ tenantId: 't1', userId: 'u1' })
    expect(await mcpContextFor(SECRET + 'x')).toBeNull()
    expect(await mcpContextFor('')).toBeNull()
  })

  it('stays off when the secret is too short or the user is unknown', async () => {
    vi.stubEnv('MCP_CONNECTOR_SECRET', 'short')
    expect(await mcpContextFor('short')).toBeNull()
    vi.stubEnv('MCP_CONNECTOR_SECRET', SECRET)
    vi.stubEnv('MCP_USER_ID', 'nobody')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await mcpContextFor(SECRET)).toBeNull()
  })
})

describe('mcp route', () => {
  it('404s a wrong secret before reading the body', async () => {
    const res = await post('wrong', { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(res.status).toBe(404)
  })

  it('answers requests with JSON and notifications with 202', async () => {
    const list = await post(SECRET, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(list.status).toBe(200)
    expect(list.headers.get('cache-control')).toBe('no-store')
    const body = await list.json() as { result: { tools: { name: string }[] } }
    expect(body.result.tools.map(t => t.name)).toContain('find_work_orders')

    const note = await post(SECRET, { jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(note.status).toBe(202)
  })

  it('has no stream to offer on GET', async () => {
    const res = await GET(new NextRequest(`https://app.test/api/mcp/${SECRET}`), { params: Promise.resolve({ secret: SECRET }) })
    expect(res.status).toBe(405)
  })
})
