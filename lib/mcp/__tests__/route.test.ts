import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// The connector key is the only thing standing between the internet and the
// app's data: anything but the exact key in the Authorization header is a 401.

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

const { POST, GET } = await import('@/app/api/mcp/route')
const { mcpContextFor, keyFromAuthorization } = await import('../auth')

const post = (authorization: string | null, body: unknown) =>
  POST(new NextRequest('https://app.test/api/mcp', {
    method: 'POST',
    headers: authorization ? { authorization } : {},
    body: JSON.stringify(body),
  }))

beforeEach(() => {
  vi.stubEnv('MCP_CONNECTOR_SECRET', SECRET)
  vi.stubEnv('MCP_USER_ID', 'u1')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('mcp auth', () => {
  it('reads the key from a Bearer header or a bare value', () => {
    expect(keyFromAuthorization(`Bearer ${SECRET}`)).toBe(SECRET)
    expect(keyFromAuthorization(` bearer  ${SECRET} `)).toBe(SECRET)
    expect(keyFromAuthorization(SECRET)).toBe(SECRET)
    expect(keyFromAuthorization(null)).toBe('')
  })

  it('accepts only the exact key, and resolves the tenant from MCP_USER_ID', async () => {
    expect(await mcpContextFor(`Bearer ${SECRET}`)).toMatchObject({ tenantId: 't1', userId: 'u1' })
    expect(await mcpContextFor(`Bearer ${SECRET}x`)).toBeNull()
    expect(await mcpContextFor(null)).toBeNull()
    expect(await mcpContextFor('Bearer ')).toBeNull()
  })

  it('ignores whitespace pasted into the env vars', async () => {
    vi.stubEnv('MCP_CONNECTOR_SECRET', ` ${SECRET}\n`)
    vi.stubEnv('MCP_USER_ID', 'u1\n')
    expect(await mcpContextFor(`Bearer ${SECRET}`)).toMatchObject({ tenantId: 't1', userId: 'u1' })
  })

  it('stays off when the secret is too short or the user is unknown', async () => {
    vi.stubEnv('MCP_CONNECTOR_SECRET', 'short')
    expect(await mcpContextFor('Bearer short')).toBeNull()
    vi.stubEnv('MCP_CONNECTOR_SECRET', SECRET)
    vi.stubEnv('MCP_USER_ID', 'nobody')
    expect(await mcpContextFor(`Bearer ${SECRET}`)).toBeNull()
  })
})

describe('mcp route', () => {
  it('401s a missing or wrong key', async () => {
    expect((await post(null, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401)
    expect((await post('Bearer wrong', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401)
  })

  it('answers requests with JSON and notifications with 202', async () => {
    const list = await post(`Bearer ${SECRET}`, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(list.status).toBe(200)
    expect(list.headers.get('cache-control')).toBe('no-store')
    const body = await list.json() as { result: { tools: { name: string }[] } }
    expect(body.result.tools.map(t => t.name)).toContain('find_work_orders')

    const note = await post(`Bearer ${SECRET}`, { jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(note.status).toBe(202)
  })

  it('has no stream to offer on GET', async () => {
    const res = await GET(new NextRequest('https://app.test/api/mcp', { headers: { authorization: `Bearer ${SECRET}` } }))
    expect(res.status).toBe(405)
  })
})
