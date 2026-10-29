import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'
import { parseDecisions, reviewAll, reviewFeature } from '../review'

// The nightly review keeps the lessons from what the office did. The model
// suggests; the code holds the rules: new lessons need a pattern (two cases
// or a general instruction), track records count new cases once, and a
// lesson contradicted more than it's borne out goes.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables)

let answer: Record<string, unknown> = {}
const create = vi.fn(async () => ({
  model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 },
  content: [{ type: 'text', text: JSON.stringify({ support: [], contradict: [], refine: [], add: [], retire: [], ...answer }) }],
}))
const client = { beta: { messages: { create } } }

const NOW = new Date('2026-10-29T10:00:00Z')
const event = (id: string, created_at: string, extra: Row = {}): Row => ({
  id, tenant_id: 't1', feature: 'action_card', situation: {}, situation_text: `case ${id}`, changes: [], outcome: 'edited', instruction: null, created_at, ...extra,
})
const lesson = (id: string, extra: Row = {}): Row => ({
  id, tenant_id: 't1', feature: 'action_card', applies_when: `when ${id}`, lesson: `do ${id}`, status: 'active', source: 'learned',
  support_count: 1, contradict_count: 0, evidence_ids: [], retired_reason: null, created_at: `2026-10-0${id.slice(1)}`, ...extra,
})

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  answer = {}
  create.mockClear()
})

describe('reviewFeature', () => {
  it('makes no model call when nothing is new', async () => {
    tables.learning_reviews = [{ tenant_id: 't1', feature: 'action_card', reviewed_to: '2026-10-28T00:00:00Z' }]
    tables.learning_events = [event('a', '2026-10-27T00:00:00Z')]
    const out = await reviewFeature(db as never, { tenantId: 't1', feature: 'action_card', client: client as never, now: NOW })
    expect(out.skipped).toBe('Nothing new')
    expect(create).not.toHaveBeenCalled()
  })

  it('shows lessons, new and earlier cases, and moves the watermark to the newest case', async () => {
    tables.learning_reviews = [{ tenant_id: 't1', feature: 'action_card', reviewed_to: '2026-10-20T00:00:00Z' }]
    tables.learning_events = [event('old', '2026-10-10T00:00:00Z'), event('n1', '2026-10-25T00:00:00Z', { instruction: 'cc the assessor' }), event('other', '2026-10-26T00:00:00Z', { tenant_id: 't2' })]
    tables.learning_lessons = [lesson('L1')]
    const out = await reviewFeature(db as never, { tenantId: 't1', feature: 'action_card', client: client as never, now: NOW })
    const prompt = (create.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0].content
    expect(prompt).toContain('L1 [1 for, 0 against] When: when L1')
    expect(prompt).toContain('N1 (2026-10-25, edited) case n1\n   Instruction: "cc the assessor"')
    expect(prompt).toContain('E1 (2026-10-10, edited) case old')
    expect(prompt).not.toContain('case other')
    expect(out.reviewed).toBe(1)
    expect(tables.learning_reviews[0]).toMatchObject({ reviewed_to: '2026-10-25T00:00:00Z', summary: { reviewed: 1 } })
  })

  it('adds a lesson only for a pattern: two cases or a general instruction', async () => {
    tables.learning_events = [
      event('a', '2026-10-25T00:00:00Z'),
      event('b', '2026-10-26T00:00:00Z'),
      event('c', '2026-10-27T00:00:00Z', { outcome: 'instructed', instruction: 'Always copy in the assessor on Allianz make safes' }),
    ]
    answer = {
      add: [
        { applies_when: 'Allianz make safes', lesson: 'Copy in the assessor', cases: ['N1', 'N2'] },
        { applies_when: 'One-off', lesson: 'From one edit', cases: ['N1'] },
        { applies_when: 'Allianz make safes (said)', lesson: 'Copy in the assessor', cases: ['N3'] },
        { applies_when: 'Made up', lesson: 'No real cases', cases: ['N9', 'E4'] },
      ],
    }
    const out = await reviewFeature(db as never, { tenantId: 't1', feature: 'action_card', client: client as never, now: NOW })
    expect(out.added).toBe(2)
    expect(tables.learning_lessons.map(l => l.applies_when)).toEqual(['Allianz make safes', 'Allianz make safes (said)'])
    expect(tables.learning_lessons[0]).toMatchObject({ source: 'learned', status: 'active', support_count: 2, evidence_ids: ['a', 'b'] })
    expect(tables.learning_reviews[0]).toMatchObject({ tenant_id: 't1', feature: 'action_card', reviewed_to: '2026-10-27T00:00:00Z' })
  })

  it('counts new cases once on a lesson\'s record, and retires one contradicted more than borne out', async () => {
    tables.learning_reviews = [{ tenant_id: 't1', feature: 'action_card', reviewed_to: '2026-10-20T00:00:00Z' }]
    tables.learning_events = [event('old', '2026-10-10T00:00:00Z'), event('a', '2026-10-25T00:00:00Z'), event('b', '2026-10-26T00:00:00Z')]
    tables.learning_lessons = [lesson('L1', { evidence_ids: ['a'] }), lesson('L2', { support_count: 0, contradict_count: 1 })]
    answer = {
      support: [{ lesson: 'L1', cases: ['N1', 'N2', 'E1'] }],
      contradict: [{ lesson: 'L2', cases: ['N1', 'N1'] }],
    }
    const out = await reviewFeature(db as never, { tenantId: 't1', feature: 'action_card', client: client as never, now: NOW })
    const [l1, l2] = tables.learning_lessons
    // 'a' was already on L1's record, the earlier case doesn't count: only 'b'
    expect(l1).toMatchObject({ support_count: 2, evidence_ids: ['a', 'b'], status: 'active' })
    expect(l2).toMatchObject({ contradict_count: 2, status: 'retired', retired_reason: 'Contradicted more often than borne out (2 against, 0 for)' })
    expect(out).toMatchObject({ supported: 1, contradicted: 1, retired: 1 })
  })

  it('narrows a lesson and starts its record again; retires one the model says is wrong', async () => {
    tables.learning_events = [event('a', '2026-10-25T00:00:00Z'), event('b', '2026-10-26T00:00:00Z')]
    tables.learning_lessons = [lesson('L1', { support_count: 4, contradict_count: 2 }), lesson('L2'), lesson('L3', { status: 'retired', retired_reason: 'old' })]
    answer = {
      refine: [{ lesson: 'L1', applies_when: 'Allianz make safes only', lesson_text: 'Copy in the assessor', cases: ['N1', 'N2'] }],
      retire: [{ lesson: 'L2', why: 'The office stopped doing this' }, { lesson: 'L3', why: 'again' }, { lesson: 'L9', why: 'no such' }],
    }
    const out = await reviewFeature(db as never, { tenantId: 't1', feature: 'action_card', client: client as never, now: NOW })
    expect(tables.learning_lessons[0]).toMatchObject({ applies_when: 'Allianz make safes only', support_count: 2, contradict_count: 0, status: 'active' })
    expect(tables.learning_lessons[1]).toMatchObject({ status: 'retired', retired_reason: 'The office stopped doing this' })
    expect(tables.learning_lessons[2]).toMatchObject({ status: 'retired', retired_reason: 'old' })
    expect(out).toMatchObject({ refined: 1, retired: 1 })
  })

  it('leaves the watermark when the model declines, so the next run tries again', async () => {
    tables.learning_events = [event('a', '2026-10-25T00:00:00Z')]
    create.mockResolvedValueOnce({ model: 'm', stop_reason: 'refusal', usage: { input_tokens: 1, output_tokens: 0 }, content: [] } as never)
    await expect(reviewFeature(db as never, { tenantId: 't1', feature: 'action_card', client: client as never, now: NOW })).rejects.toThrow('declined')
    expect(tables.learning_reviews ?? []).toHaveLength(0)
  })
})

describe('reviewAll', () => {
  it('reviews each company\'s features with recent decisions, carrying on past a failure', async () => {
    tables.learning_events = [
      event('a', '2026-10-25T00:00:00Z'),
      event('b', '2026-10-26T00:00:00Z', { tenant_id: 't2' }),
      event('c', '2026-08-01T00:00:00Z', { feature: 'report' }),
    ]
    create.mockRejectedValueOnce(new Error('overloaded'))
    const out = await reviewAll(db as never, { client: client as never, now: NOW })
    expect(out.map(r => [r.tenantId, r.feature, r.error ?? r.reviewed])).toEqual([['t1', 'action_card', 'overloaded'], ['t2', 'action_card', 1]])
  })
})

describe('parseDecisions', () => {
  it('drops anything malformed', () => {
    expect(parseDecisions(JSON.stringify({ support: [{ lesson: 'L1', cases: ['N1', 3] }, { cases: [] }], add: [{ applies_when: '', lesson: 'x', cases: [] }], retire: 'no' })))
      .toEqual({ support: [{ lesson: 'L1', cases: ['N1'] }], contradict: [], refine: [], add: [], retire: [] })
    expect(() => parseDecisions('not json')).toThrow()
  })
})
