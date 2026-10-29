import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'

// A just-made card runs by itself only when its category is set to
// auto-confirm — as the person who turned it on — and is never learned from.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables)

const ran: string[] = []
const tool = (name: string) => ({
  name, title: name, description: name, inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: false }, run: vi.fn(async (_a: unknown, ctx: { userId: string }) => { ran.push(`${name} as ${ctx.userId}`); return { text: 'ok' } }),
})
vi.mock('@/lib/mcp/tools', () => ({ MCP_TOOLS: [tool('add_job_note'), tool('file_conversation')] }))
vi.mock('@/lib/mail/sync', () => ({ mailDb: () => db, getMailbox: async () => ({ id: 'mb1' }) }))
let level = 'allowed'
vi.mock('@/lib/permissions/resolve', () => ({ permissionLevel: async () => level, refusalMessage: () => 'no' }))

const { autoConfirmCard, mayAutoConfirm } = await import('../auto-confirm')

const STEPS = [
  { id: 's1', tool: 'file_conversation', args: { job_number: 'IRC1' }, summary: 'File on IRC1', kind: 'filing' },
  { id: 's2', tool: 'add_job_note', args: { note: 'x' }, summary: 'Add job note — x', kind: 'change' },
]
const card = (extra: Row = {}): Row => ({
  id: 'k1', tenant_id: 't1', source: 'email', source_ref: 'th1', status: 'pending', category: 'invoice', starred_by: null, error_log: null,
  steps: structuredClone(STEPS), ai_steps: structuredClone(STEPS), situation: {}, attempts: 1, ...extra,
})

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  ran.length = 0
  level = 'allowed'
  tables.learning_auto_confirm = [{ tenant_id: 't1', feature: 'action_card', kind: 'invoice', enabled: true, changed_by: 'u7' }]
})

describe('autoConfirmCard', () => {
  it('runs every step as the person who turned it on, says so, and records nothing to learn from', async () => {
    tables.action_queue = [card()]
    const done = await autoConfirmCard(db as never, 't1', 'k1')
    expect(done?.status).toBe('done')
    expect(ran).toEqual(['file_conversation as u7', 'add_job_note as u7'])
    expect(tables.action_queue[0]).toMatchObject({ outcome: 'Auto-confirmed: 2 steps done', confirmed_by: 'u7' })
    expect(tables.learning_events ?? []).toHaveLength(0)
  })

  it('leaves the card when auto-confirm is off for its category', async () => {
    tables.action_queue = [card({ category: 'other' })]
    expect(await autoConfirmCard(db as never, 't1', 'k1')).toBeNull()
    tables.learning_auto_confirm[0].enabled = false
    tables.action_queue = [card()]
    expect(await autoConfirmCard(db as never, 't1', 'k1')).toBeNull()
    expect(ran).toEqual([])
    expect(tables.action_queue[0].status).toBe('pending')
  })

  it('leaves it when the person it runs as may no longer confirm cards', async () => {
    level = 'approval'
    tables.action_queue = [card()]
    expect(await autoConfirmCard(db as never, 't1', 'k1')).toBeNull()
    expect(ran).toEqual([])
  })

  it('never runs a starred card, a follow-up, an unfinished card or one with nothing to do', () => {
    expect(mayAutoConfirm(card() as never)).toBe(true)
    expect(mayAutoConfirm(card({ starred_by: 'u1' }) as never)).toBe(false)
    expect(mayAutoConfirm(card({ source: 'followup' }) as never)).toBe(false)
    expect(mayAutoConfirm(card({ error_log: 'The AI didn\'t finish the card' }) as never)).toBe(false)
    expect(mayAutoConfirm(card({ steps: [] }) as never)).toBe(false)
    expect(mayAutoConfirm(card({ status: 'no_action' }) as never)).toBe(false)
  })
})
