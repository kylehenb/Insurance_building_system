import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'

// "Tell the AI what to change" for one step: the AI's answer replaces just
// that step (or takes it off); the other steps, the title and the summary
// stay, and the card is back on the list — as it was if the AI can't.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables)

const tool = (name: string, readOnly = false) => ({
  name, title: name.replace(/_/g, ' '), description: name, inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: readOnly }, run: vi.fn(async () => ({ text: 'ok' })),
})
vi.mock('@/lib/mcp/tools', () => ({ MCP_TOOLS: [tool('add_job_note'), tool('send_email'), tool('set_follow_up')] }))
vi.mock('@/lib/mcp/tools/jobs', () => ({ getJobSummary: { run: async () => ({ text: 'IRC1042 job file' }) } }))
vi.mock('@/lib/mcp/tools/mailbox', () => ({ readConversation: { run: async () => ({ text: 'The conversation' }) } }))
vi.mock('@/lib/mail/list', () => ({
  getThreadDetail: async () => ({ subject: 'Access', label_ids: ['INBOX'], messages: [{ labelIds: ['INBOX'], from: { email: 'casey@gmail.com' } }], job: { id: 'j1', job_number: 'IRC1042' }, candidates: [], orderId: null }),
}))
vi.mock('@/lib/mail/sync', () => ({ getMailbox: async () => ({ id: 'mb1' }), mailDb: () => db }))
const discarded: string[] = []
vi.mock('../steps', () => ({ discardStepDrafts: async (card: { steps: { draft?: { id: string } }[] }) => { card.steps.forEach(s => s.draft && discarded.push(s.draft.id)) } }))

// The model: each test says what it answers (tool calls), then it finishes
let answer: { name: string; input: Row }[] = []
const create = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({ default: class { beta = { messages: { create } } } }))

const { resuggestStep, replaceStep } = await import('../propose')

const STEPS = [
  { id: 's1', tool: 'add_job_note', args: { note: 'a' }, summary: 'Add job note — a', kind: 'change' },
  { id: 's2', tool: 'send_email', args: { body: 'Hi Casey' }, summary: 'Reply', kind: 'email', draft: { id: 'dr1', to: '', cc: '', bcc: '', subject: '', html: '' } },
  { id: 's3', tool: 'set_follow_up', args: { note: 'chase' }, summary: 'Remind me: chase', kind: 'change' },
]

beforeEach(() => {
  discarded.length = 0
  create.mockReset()
  create.mockImplementation(async () => {
    const blocks = [...answer.map((a, i) => ({ type: 'tool_use', id: `t${i}`, name: a.name, input: a.input })), { type: 'tool_use', id: 'fin', name: 'finish_card', input: { needs_action: true, title: 'New title', summary: 'New summary', priority: 'normal', category: 'other' } }]
    return { content: blocks, stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } }
  })
  tables.users = [{ id: 'u1', tenant_id: 't1', role: 'admin', created_at: '2026-01-01' }]
  tables.action_queue = [{ id: 'k1', tenant_id: 't1', job_id: 'j1', source: 'email', source_ref: 'th1', status: 'pending', title: 'Reply to Casey', description: 'Casey asked about access', steps: structuredClone(STEPS), category: 'other', updated_at: 'then' }]
})

describe('replaceStep', () => {
  it('puts the replacement where the step was, or takes it off', () => {
    const r = [{ ...STEPS[0], id: 'n1' }]
    expect(replaceStep(STEPS as never, 's2', r as never).map(s => s.id)).toEqual(['s1', 'n1', 's3'])
    expect(replaceStep(STEPS as never, 's2', []).map(s => s.id)).toEqual(['s1', 's3'])
    expect(replaceStep(STEPS as never, 'nope', r as never)).toBe(STEPS)
  })
})

describe('resuggestStep', () => {
  it('replaces only that step, keeping the others, the title and the summary', async () => {
    answer = [{ name: 'add_job_note', input: { note: 'waiting on the strata manager' } }]
    const card = await resuggestStep(db as never, 't1', 'k1', 's2', 'don\'t reply — note we\'re waiting on strata')
    expect(card.status).toBe('pending')
    expect(card.title).toBe('Reply to Casey')
    expect(card.description).toBe('Casey asked about access')
    expect(card.steps.map(s => s.id).filter(id => id !== card.steps[1].id)).toEqual(['s1', 's3'])
    expect(card.steps[1]).toMatchObject({ tool: 'add_job_note', args: { note: 'waiting on the strata manager' } })
    expect(discarded).toEqual(['dr1'])
    const first = create.mock.calls[0][0].messages[0].content as string
    expect(first).toContain('only step 2 ("Reply") changed')
    expect(first).toContain('don\'t reply — note we\'re waiting on strata')
  })

  it('takes the step off when the AI proposes nothing in its place', async () => {
    answer = []
    const card = await resuggestStep(db as never, 't1', 'k1', 's1', 'drop this one')
    expect(card.steps.map(s => s.id)).toEqual(['s2', 's3'])
  })

  it('leaves the card as it was when the AI fails', async () => {
    create.mockRejectedValueOnce(new Error('overloaded'))
    await expect(resuggestStep(db as never, 't1', 'k1', 's2', 'shorter')).rejects.toThrow('overloaded')
    const row = tables.action_queue[0]
    expect(row.status).toBe('pending')
    expect((row.steps as Row[]).map(s => s.id)).toEqual(['s1', 's2', 's3'])
    expect(discarded).toEqual([])
  })

  it('won\'t change a step that\'s done, or a card that isn\'t on the list', async () => {
    (tables.action_queue[0].steps as Row[])[0].status = 'done'
    await expect(resuggestStep(db as never, 't1', 'k1', 's1', 'x')).rejects.toThrow('already been done')
    tables.action_queue[0].status = 'running'
    await expect(resuggestStep(db as never, 't1', 'k1', 's2', 'x')).rejects.toThrow('can\'t be changed now')
    await expect(resuggestStep(db as never, 't1', 'k1', 's2', '  ')).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
  })
})
