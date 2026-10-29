import { describe, it, expect, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'
import { accuracy, learningStats } from '../stats'
import { getLesson, listLessons, setLessonActive } from '../lessons'

// How often the AI gets it right, and lessons turned off and on by a person.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables)
const NOW = new Date('2026-10-29T00:00:00Z')

const event = (outcome: string, created_at: string, extra: Row = {}): Row => ({ tenant_id: 't1', feature: 'action_card', kind: 'other', outcome, created_at, ...extra })

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
})

describe('learningStats', () => {
  it('tallies this period against the one before, by kind, leaving instructions out of the decided count', async () => {
    tables.learning_events = [
      event('accepted', '2026-10-20T00:00:00Z'),
      event('accepted', '2026-10-21T00:00:00Z', { kind: 'invoice' }),
      event('edited', '2026-10-22T00:00:00Z'),
      event('skipped', '2026-10-23T00:00:00Z'),
      event('instructed', '2026-10-24T00:00:00Z'),
      event('edited', '2026-09-10T00:00:00Z'),
      event('accepted', '2026-10-25T00:00:00Z', { tenant_id: 't2' }),
      event('accepted', '2026-07-01T00:00:00Z'),
    ]
    const [s] = await learningStats(db as never, 't1', { days: 30, now: NOW })
    expect(s.current).toEqual({ decided: 4, accepted: 2, edited: 1, skipped: 1, instructed: 1 })
    expect(s.previous).toEqual({ decided: 1, accepted: 0, edited: 1, skipped: 0, instructed: 0 })
    expect(s.byKind.map(k => [k.kind, k.decided, k.accepted])).toEqual([['other', 3, 1], ['invoice', 1, 1]])
    expect(accuracy(s.current)).toBe(50)
    expect(accuracy(s.previous)).toBe(0)
  })

  it('is empty (not an error) when the table can\'t be read', async () => {
    expect(await learningStats({ from: () => { throw new Error('down') } } as never, 't1')).toEqual([])
  })
})

describe('lessons on and off', () => {
  beforeEach(() => {
    tables.learning_lessons = [
      { id: 'l1', tenant_id: 't1', feature: 'action_card', applies_when: 'a', lesson: 'A', status: 'active', source: 'learned', support_count: 3, contradict_count: 1, retired_reason: null, updated_at: '2026-10-01' },
      { id: 'l2', tenant_id: 't1', feature: 'action_card', applies_when: 'b', lesson: 'B', status: 'retired', source: 'learned', support_count: 0, contradict_count: 2, retired_reason: 'old', updated_at: '2026-10-05' },
      { id: 'l3', tenant_id: 't2', feature: 'action_card', applies_when: 'c', lesson: 'C', status: 'active', source: 'learned', support_count: 0, contradict_count: 0, retired_reason: null, updated_at: '2026-10-06' },
    ]
  })

  it('lists a company\'s lessons, those in use first', async () => {
    expect((await listLessons(db as never, 't1')).map(l => l.id)).toEqual(['l1', 'l2'])
  })

  it('turns one off saying who, and back on with a fresh record', async () => {
    await setLessonActive(db as never, 't1', 'l1', false, 'Kyle')
    expect(tables.learning_lessons[0]).toMatchObject({ status: 'retired', retired_reason: 'Turned off by Kyle' })
    await setLessonActive(db as never, 't1', 'l2', true, 'Kyle')
    expect(tables.learning_lessons[1]).toMatchObject({ status: 'active', retired_reason: null, support_count: 0, contradict_count: 0 })
  })

  it('won\'t touch another company\'s lesson', async () => {
    expect(await setLessonActive(db as never, 't1', 'l3', false, 'Kyle')).toBeNull()
    expect(tables.learning_lessons[2].status).toBe('active')
    expect(await getLesson(db as never, 't1', 'l3')).toBeNull()
  })
})
