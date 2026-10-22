import { describe, it, expect, vi } from 'vitest'
import { handleMcpMessage, SUPPORTED_PROTOCOL_VERSIONS, type McpTool } from '../server'

// The JSON-RPC layer of the voice connector: handshake, tool list, tool calls.

const ctx = { supabase: {} as never, tenantId: 't1', userId: 'u1' }
const echo: McpTool = {
  name: 'echo', title: 'Echo', description: 'Echoes', inputSchema: { type: 'object' },
  annotations: { readOnlyHint: true },
  run: vi.fn(async (args: Record<string, unknown>) => ({ text: `got ${String(args.x)}`, data: { x: args.x } })),
}
const broken: McpTool = { ...echo, name: 'broken', title: 'Broken', run: async () => { throw new Error('boom') } }
const tools = [echo, broken]
const call = (method: string, params?: Record<string, unknown>) =>
  handleMcpMessage({ jsonrpc: '2.0', id: 1, method, params }, tools, ctx)

describe('mcp server', () => {
  it('agrees a protocol version on initialize', async () => {
    const known = await call('initialize', { protocolVersion: '2025-06-18' })
    expect(known).toMatchObject({ id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } } })
    const unknown = await call('initialize', { protocolVersion: '1999-01-01' })
    expect(unknown).toMatchObject({ result: { protocolVersion: SUPPORTED_PROTOCOL_VERSIONS[0] } })
  })

  it('lists tools without their handlers', async () => {
    const res = await call('tools/list') as { result: { tools: Record<string, unknown>[] } }
    expect(res.result.tools.map(t => t.name)).toEqual(['echo', 'broken'])
    expect(res.result.tools[0]).not.toHaveProperty('run')
  })

  it('calls a tool and returns text plus data', async () => {
    const res = await call('tools/call', { name: 'echo', arguments: { x: 7 } })
    expect(res).toMatchObject({ result: { content: [{ type: 'text', text: 'got 7' }], structuredContent: { x: 7 }, isError: false } })
    expect(echo.run).toHaveBeenCalledWith({ x: 7 }, ctx)
  })

  it('turns a thrown tool error into an error result', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call('tools/call', { name: 'broken' }) as { result: { isError: boolean; content: { text: string }[] } }
    expect(res.result.isError).toBe(true)
    expect(res.result.content[0].text).toMatch(/Check the app/)
  })

  it('rejects unknown tools and methods, ignores notifications', async () => {
    expect(await call('tools/call', { name: 'nope' })).toMatchObject({ error: { code: -32602 } })
    expect(await call('resources/list')).toMatchObject({ error: { code: -32601 } })
    expect(await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, tools, ctx)).toBeNull()
    expect(await handleMcpMessage({ hello: 'world' }, tools, ctx)).toMatchObject({ error: { code: -32600 } })
  })
})
