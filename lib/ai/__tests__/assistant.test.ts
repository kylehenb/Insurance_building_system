import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpTool } from '@/lib/mcp/server'

// The in-app assistant: the tool loop, the connector tools run as the user
// (same permission, approval and log path as voice) and the read-only lookup.

const level = vi.fn(async () => 'allowed')
const requestApproval = vi.fn(async () => ({ id: 'a1', summary: 'Send work order', existing: false, message: 'Sent for approval: Send work order.' }))
const recordVoiceCall = vi.fn(async () => {})
vi.mock('@/lib/permissions/resolve', () => ({ permissionLevel: level, refusalMessage: () => "You aren't allowed to do that." }))
vi.mock('@/lib/approvals/service', () => ({ requestApproval }))
vi.mock('@/lib/activity/log', () => ({ recordVoiceCall }))
vi.mock('@/lib/mcp/tools', () => ({ MCP_TOOLS: [] }))

const { runAssistantTurn, readRecords, assistantTools } = await import('../assistant')

const lookup: McpTool = {
  name: 'get_job_summary', title: 'Job summary', description: 'Job', inputSchema: { type: 'object' },
  annotations: { readOnlyHint: true },
  run: vi.fn(async () => ({ text: 'IRC1008 is at quoting.', data: { job_id: 'j1' } })),
}
const send: McpTool = {
  name: 'send_work_order', title: 'Send work order', description: 'Send', inputSchema: { type: 'object' },
  annotations: {}, permission: 'send.work_orders',
  run: vi.fn(async () => ({ text: 'Sent to Ace Plumbing.' })),
}
const tools = [lookup, send]
const ctx = { supabase: {} as never, tenantId: 't1', userId: 'u1' }

type Block = Record<string, unknown>
const reply = (stop_reason: string, ...content: Block[]) => ({ stop_reason, content })
const toolUse = (id: string, name: string, input: Block = {}) => ({ type: 'tool_use', id, name, input })
const text = (t: string) => ({ type: 'text', text: t })

function fakeClient(...responses: ReturnType<typeof reply>[]) {
  const create = vi.fn()
  for (const r of responses) create.mockResolvedValueOnce(r)
  return { client: { beta: { messages: { create } } } as never, create }
}

const turn = (client: never, history: never[] = []) =>
  runAssistantTurn({ client, history, userContent: [{ type: 'text', text: 'How is IRC1008 going?' }], ctx, tools, model: 'claude-sonnet-5-5' })

beforeEach(() => vi.clearAllMocks())

describe('assistant turn', () => {
  it('runs the tools Claude asks for and returns its answer with the whole conversation', async () => {
    const { client, create } = fakeClient(
      reply('tool_use', text('Checking.'), toolUse('c1', 'get_job_summary', { job_number: 'IRC1008' })),
      reply('end_turn', text('IRC1008 is at quoting.')),
    )
    const out = await turn(client)

    expect(out.text).toBe('IRC1008 is at quoting.')
    // Tools know the assistant is calling (e.g. notes are marked "assistant", not "voice")
    expect(lookup.run).toHaveBeenCalledWith({ job_number: 'IRC1008' }, { ...ctx, via: 'chat' })
    // user → assistant (tool call) → tool result → assistant answer
    expect(out.history.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(out.history[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'c1', content: 'IRC1008 is at quoting.\n{"job_id":"j1"}', is_error: false },
    ])
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[0][0]).toMatchObject({ model: 'claude-sonnet-5-5', tool_choice: { type: 'auto' }, fallbacks: 'default' })
  })

  it('carries on an earlier conversation', async () => {
    const { client } = fakeClient(reply('end_turn', text('Done.')))
    const earlier = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: [text('Hello')] }] as never[]
    const out = await turn(client, earlier)
    expect(out.history.slice(0, 2)).toEqual(earlier)
    expect(out.history.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
  })

  it('checks permissions the same way as the voice connector', async () => {
    level.mockResolvedValueOnce('blocked')
    const { client } = fakeClient(reply('tool_use', toolUse('c1', 'send_work_order')), reply('end_turn', text("You can't send that.")))
    const out = await turn(client)
    expect(send.run).not.toHaveBeenCalled()
    expect(out.history[2].content).toMatchObject([{ is_error: true, content: expect.stringMatching(/aren't allowed/) }])
  })

  it('queues a send that needs approval, marked as from the assistant', async () => {
    level.mockResolvedValueOnce('approval')
    const { client } = fakeClient(reply('tool_use', toolUse('c1', 'send_work_order', { work_order_id: 'w1' })), reply('end_turn', text('Waiting for approval.')))
    await turn(client)
    expect(send.run).not.toHaveBeenCalled()
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'voice.tool', via: 'app', payload: { tool: 'send_work_order', args: { work_order_id: 'w1' }, via: 'chat' },
    }))
  })

  it('logs what it sent as done in the app', async () => {
    const { client } = fakeClient(reply('tool_use', toolUse('c1', 'send_work_order')), reply('end_turn', text('Sent.')))
    await turn(client)
    expect(send.run).toHaveBeenCalled()
    expect(recordVoiceCall).toHaveBeenCalledWith(expect.objectContaining({ action: 'send.work_orders', via: 'app', outcome: 'done' }))
  })

  it('tells Claude when it asks for a tool that does not exist', async () => {
    const { client } = fakeClient(reply('tool_use', toolUse('c1', 'delete_everything')), reply('end_turn', text('I cannot do that.')))
    const out = await turn(client)
    expect(out.history[2].content).toMatchObject([{ is_error: true, content: expect.stringMatching(/no tool called/) }])
  })

  it('makes Claude answer after the step limit instead of looping forever', async () => {
    const { client, create } = fakeClient(...Array.from({ length: 14 }, (_, i) => reply('tool_use', toolUse(`c${i}`, 'get_job_summary'))), reply('end_turn', text('Here is what I found.')))
    const out = await turn(client)
    expect(create).toHaveBeenCalledTimes(15)
    expect(create.mock.calls[14][0].tool_choice).toEqual({ type: 'none' })
    expect(out.text).toBe('Here is what I found.')
  })

  it('leaves out the fallback setting on Haiku', async () => {
    const { client, create } = fakeClient(reply('end_turn', text('Hi.')))
    await runAssistantTurn({ client, history: [], userContent: [text('hi') as never], ctx, tools, model: 'claude-haiku-5-5' })
    expect(create.mock.calls[0][0]).not.toHaveProperty('fallbacks')
  })

  it('offers every connector tool plus the read-only lookup', () => {
    expect(assistantTools(tools).map(t => t.name)).toEqual(['get_job_summary', 'send_work_order', 'read_records'])
  })
})

describe('tools that return photos or only prepare a draft', () => {
  const photo: McpTool = {
    name: 'get_job_photo', title: 'View job photo', description: 'Photo', inputSchema: { type: 'object' },
    annotations: { readOnlyHint: true },
    run: vi.fn(async () => ({ text: 'IRC1055: photo 2 (Floor plan)', images: [{ data: 'AAAA', mimeType: 'image/jpeg' }] })),
  }
  const draft: McpTool = {
    name: 'save_draft', title: 'Save draft', description: 'Draft', inputSchema: { type: 'object' },
    annotations: {}, permission: 'mail.send', runsAtApproval: true,
    run: vi.fn(async () => ({ text: 'Draft saved.' })),
  }

  it('shows Claude the photo, but keeps it out of the history sent back to the browser', async () => {
    const { client, create } = fakeClient(reply('tool_use', toolUse('c1', 'get_job_photo')), reply('end_turn', text('4.2 by 3.6 metres.')))
    const out = await runAssistantTurn({ client, history: [], userContent: [{ type: 'text', text: 'Size of the kitchen?' }], ctx, tools: [photo], model: 'claude-sonnet-5-5' })
    const sent = create.mock.calls[1][0].messages[2].content[0]
    expect(sent.content).toEqual([
      { type: 'text', text: 'IRC1055: photo 2 (Floor plan)' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
    ])
    expect(out.history[2].content).toEqual([{
      type: 'tool_result', tool_use_id: 'c1', is_error: false,
      content: [{ type: 'text', text: 'IRC1055: photo 2 (Floor plan)' }, { type: 'text', text: '(1 image shown here earlier — call the tool again to look again.)' }],
    }])
  })

  it('runs a draft at "needs approval" instead of queueing it', async () => {
    level.mockResolvedValueOnce('approval')
    const { client } = fakeClient(reply('tool_use', toolUse('c1', 'save_draft')), reply('end_turn', text('Saved.')))
    await runAssistantTurn({ client, history: [], userContent: [{ type: 'text', text: 'Draft it' }], ctx, tools: [draft], model: 'claude-sonnet-5-5' })
    expect(draft.run).toHaveBeenCalled()
    expect(requestApproval).not.toHaveBeenCalled()
  })
})

describe('read_records', () => {
  function fakeDb(rows: Block[]) {
    const eqs: [string, unknown][] = []
    const q = {
      select: () => q, limit: () => q,
      eq: (c: string, v: unknown) => { eqs.push([c, v]); return q },
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res),
    }
    return { supabase: { from: vi.fn(() => q) } as never, eqs }
  }

  it("only reads the user's own company, whatever filter it's given", async () => {
    const { supabase, eqs } = fakeDb([{ quote_ref: 'Q1008-1' }])
    const out = await readRecords({ table: 'quotes', filters: { tenant_id: 'other', job_id: 'j1' } }, { ...ctx, supabase })
    expect(eqs).toEqual([['job_id', 'j1'], ['tenant_id', 't1']])
    expect(out.text).toContain('Q1008-1')
  })

  it('refuses tables outside the list', async () => {
    const { supabase } = fakeDb([])
    expect(await readRecords({ table: 'voice_keys' }, { ...ctx, supabase })).toMatchObject({ isError: true })
  })
})
