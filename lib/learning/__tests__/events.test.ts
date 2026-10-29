import { describe, it, expect, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'
import { formatCases, likeness, recordLearning, similarCases, type LearningEvent, type Likeness } from '../events'
import { activeLessons, formatLessons } from '../lessons'

// The learning module: decisions recorded with their situation, and the
// most alike past cases found for a new one — alike in the facts that
// matter, not just the same feature.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables)

const LIKE: Likeness = { weights: { sender: 4, insurer: 2, subject: 3 }, text: ['subject'], minScore: 3 }

const event = (id: string, situation: Record<string, string | null>, created_at: string, extra: Row = {}): Row => ({
  id, tenant_id: 't1', feature: 'action_card', source_id: `card-${id}`, situation, situation_text: `case ${id}`,
  changes: [], outcome: 'accepted', instruction: null, created_at, ...extra,
})

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
})

describe('likeness', () => {
  it('adds the weights of the facts two situations share, ignoring case', () => {
    expect(likeness({ sender: 'Jane@Allianz.com.au', insurer: 'Allianz' }, { sender: 'jane@allianz.com.au', insurer: 'Suncorp' }, LIKE)).toBe(4)
    expect(likeness({ sender: null, insurer: 'Allianz' }, { sender: null, insurer: 'allianz' }, LIKE)).toBe(2)
  })

  it('compares text facts by their shared words', () => {
    const score = likeness({ subject: 'Make safe quote IRC1042' }, { subject: 'Quote for make safe' }, LIKE)
    expect(score).toBeGreaterThan(1.5)
    expect(score).toBeLessThan(3)
  })
})

describe('similarCases', () => {
  it('returns the most alike first, leaves out weak matches and the record itself', async () => {
    tables.learning_events = [
      event('a', { sender: 'jane@allianz.com.au', insurer: 'Allianz', subject: 'Make safe' }, '2026-10-01'),
      event('b', { sender: 'bob@roofing.com.au', insurer: 'Allianz', subject: 'Invoice' }, '2026-10-02'),
      event('c', { sender: 'jane@allianz.com.au', insurer: 'Allianz', subject: 'Report' }, '2026-10-03'),
      event('d', { sender: 'jane@allianz.com.au', insurer: 'Allianz', subject: 'Make safe' }, '2026-10-04', { source_id: 'this-card' }),
      { ...event('e', { sender: 'jane@allianz.com.au' }, '2026-10-05'), feature: 'report' },
      { ...event('f', { sender: 'jane@allianz.com.au' }, '2026-10-05'), tenant_id: 't2' },
    ]
    const cases = await similarCases(db as never, {
      tenantId: 't1', feature: 'action_card', likeness: LIKE, excludeSourceId: 'this-card',
      situation: { sender: 'jane@allianz.com.au', insurer: 'Allianz', subject: 'Make safe' },
    })
    expect(cases.map(c => c.id)).toEqual(['a', 'c'])
  })

  it('finds nothing (and doesn\'t throw) when the table can\'t be read', async () => {
    const broken = { from: () => { throw new Error('down') } }
    expect(await similarCases(broken as never, { tenantId: 't1', feature: 'x', situation: {}, likeness: LIKE })).toEqual([])
  })
})

describe('recordLearning', () => {
  it('keeps the decision with its situation', async () => {
    await recordLearning(db as never, { tenantId: 't1', feature: 'action_card', situation: { sender: 'x' }, outcome: 'instructed', instruction: '  cc the assessor  ', userId: 'u1' })
    expect(tables.learning_events[0]).toMatchObject({ tenant_id: 't1', feature: 'action_card', situation: { sender: 'x' }, outcome: 'instructed', instruction: 'cc the assessor', user_id: 'u1', changes: [] })
  })

  it('never gets in the way of the work', async () => {
    const broken = { from: () => { throw new Error('down') } }
    await expect(recordLearning(broken as never, { tenantId: 't1', feature: 'x', situation: {}, outcome: 'accepted' })).resolves.toBeUndefined()
  })
})

describe('formatCases', () => {
  it('reads as what was done, with the changes and any instruction', () => {
    const text = formatCases([
      event('a', {}, '2026-10-01T04:00:00Z', { situation_text: 'Email from Jane', outcome: 'edited', changes: ['Dropped: Add job note'] }),
      event('b', {}, '2026-10-02T04:00:00Z', { situation_text: 'Email from Bob', outcome: 'instructed', instruction: 'Copy in the assessor' }),
    ] as unknown as LearningEvent[])
    expect(text).toContain('WHAT THE OFFICE DID IN SIMILAR PAST CASES')
    expect(text).toContain('1. 1 Oct — Email from Jane\n   Changed before it was done.\n   - Dropped: Add job note')
    expect(text).toContain('The office said: "Copy in the assessor"')
    expect(formatCases([])).toBe('')
  })
})

describe('lessons', () => {
  it('reads a feature\'s active lessons, best supported first', async () => {
    tables.learning_lessons = [
      { id: 'l1', tenant_id: 't1', feature: 'action_card', status: 'active', applies_when: 'Allianz make safes', lesson: 'Copy in the assessor', support_count: 2, contradict_count: 0 },
      { id: 'l2', tenant_id: 't1', feature: 'action_card', status: 'active', applies_when: 'Trade invoices', lesson: 'File on the job', support_count: 5, contradict_count: 1 },
      { id: 'l3', tenant_id: 't1', feature: 'action_card', status: 'retired', applies_when: 'x', lesson: 'y', support_count: 9, contradict_count: 9 },
      { id: 'l4', tenant_id: 't1', feature: 'report', status: 'active', applies_when: 'x', lesson: 'y', support_count: 9, contradict_count: 0 },
    ]
    const lessons = await activeLessons(db as never, 't1', 'action_card')
    expect(lessons.map(l => l.id)).toEqual(['l2', 'l1'])
    expect(formatLessons(lessons)).toContain('- When: Trade invoices\n  File on the job')
    expect(formatLessons([])).toBe('')
  })
})
