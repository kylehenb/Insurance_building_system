import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'

// The debrief: what the office says becomes a few takeaways that work at once —
// about people and house style in the shared office memory, about a task with
// that task — and a correction updates the lesson it corrects.

const tables: Record<string, Row[]> = {}
vi.mock('@/lib/health/ai-usage', () => ({ trackAi: (_m: unknown, fn: () => unknown) => fn() }))
const { debrief, spokenTakeaways, OFFICE } = await import('../debrief')
const { remember, getOfficeMemory } = await import('@/lib/mcp/tools/memory')
const { activeLessons } = await import('../lessons')

function model(points: Row[]) {
  const create = vi.fn(async () => ({ content: [{ type: 'tool_use', id: 't', name: 'record_takeaways', input: { points } }] }))
  return { client: { beta: { messages: { create } } } as never, create }
}
const db = () => fakeSupabase(tables) as never
const base = { tenantId: 't1', userId: 'u1', feature: 'action_card', happened: 'Confirmed exactly as proposed.', situation: { kind: 'email', sender_email: 'dave@brushbros.com.au' }, situationText: 'Email from Dave' }

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  tables.learning_lessons = []
  tables.learning_events = []
})

describe('debrief', () => {
  it('saves takeaways at once — people and style in the office memory, task ones with the feature — and records the words', async () => {
    const { client, create } = model([
      { lesson: 'Keep emails to Dave casual — first name, no formalities.', applies_when: 'Emails to Dave (Brush Bros)', shared: true, tone: 'neutral' },
      { lesson: 'When a trade confirms a day, also let the homeowner know.', applies_when: 'A trade confirms a booking', shared: false, tone: 'positive' },
    ])
    const points = await debrief(db(), { ...base, said: 'Spot on. Dave is pretty casual so keep it that way, and whenever a trade confirms, tell the homeowner too.', client })
    expect(points.map(p => p.shared)).toEqual([true, false])
    expect(tables.learning_lessons.map(l => [l.feature, l.source, l.status])).toEqual([[OFFICE, 'taught', 'active'], ['action_card', 'taught', 'active']])
    expect(tables.learning_events[0]).toMatchObject({ feature: 'action_card', outcome: 'instructed', instruction: expect.stringContaining('Dave is pretty casual') })
    // Read with the card's own lessons from the next card on
    expect((await activeLessons(db(), 't1', 'action_card')).map(l => l.lesson)).toHaveLength(2)
    expect((await activeLessons(db(), 't1', 'waiting_on')).map(l => l.applies_when)).toEqual(['Emails to Dave (Brush Bros)'])
    const prompt = ((create.mock.calls[0] as unknown[])[0] as { messages: { content: string }[] }).messages[0].content
    expect(prompt).toContain('WHAT THE OWNER SAID')
    expect(spokenTakeaways(points)).toMatch(/^Got it — from now on:\n• Keep emails to Dave casual/)
  })

  it('updates the lesson a correction is about instead of adding another', async () => {
    tables.learning_lessons = [{ id: 'l1', tenant_id: 't1', feature: OFFICE, applies_when: 'Emails to Dave', lesson: 'Formal tone with Dave.', status: 'active', source: 'learned', updated_at: '2026-11-01' }]
    const { client } = model([{ lesson: 'Casual with Dave.', applies_when: 'Emails to Dave', shared: true, tone: 'negative', replaces: 'L1' }])
    const points = await debrief(db(), { ...base, said: 'No, Dave is casual, not formal.', client })
    expect(points).toEqual([expect.objectContaining({ id: 'l1', replaced: true })])
    expect(tables.learning_lessons).toHaveLength(1)
    expect(tables.learning_lessons[0]).toMatchObject({ lesson: 'Casual with Dave.', source: 'taught' })
  })

  it('says nothing, costs nothing', async () => {
    const { client, create } = model([])
    expect(await debrief(db(), { ...base, said: '  ', client })).toEqual([])
    expect(create).not.toHaveBeenCalled()
  })
})

describe('remember and get_office_memory', () => {
  it('remembers by voice into the office memory, and reads back what applies to a person plus the general rules', async () => {
    tables.learning_lessons = [
      { id: 'a', tenant_id: 't1', feature: OFFICE, applies_when: 'Emails to Dave (Brush Bros)', lesson: 'Casual.', status: 'active', updated_at: '2026-11-02' },
      { id: 'b', tenant_id: 't1', feature: OFFICE, applies_when: 'Any email to a homeowner', lesson: 'Say when we\'ll be back in touch.', status: 'active', updated_at: '2026-11-01' },
      { id: 'c', tenant_id: 't1', feature: OFFICE, applies_when: 'Suncorp jobs', lesson: 'Copy in the assessor.', status: 'active', updated_at: '2026-11-03' },
    ]
    const read = await getOfficeMemory.run({ about: 'Dave' }, { supabase: db(), tenantId: 't1', userId: 'u1' } as never)
    expect(read.text).toBe('- When: Emails to Dave (Brush Bros) — Casual.\n- When: Any email to a homeowner — Say when we\'ll be back in touch.')
    // remember with nothing general taken away says so
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const empty = await remember.run({ what: '' }, { supabase: db(), tenantId: 't1', userId: 'u1' } as never)
    expect(empty.isError).toBe(true)
  })
})
