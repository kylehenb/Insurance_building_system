import { describe, it, expect, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'
import { cancelFollowUp, createFollowUp, followUpPresets, parseFollowUpWhen, releaseDueFollowUps, spokenDue, updateFollowUp } from '../followups'

// Follow-ups: a date read the way people say it (days, weeks, a date — 8am
// Perth), set as a scheduled card (optionally taking the card it came from
// off the list), moved or cancelled while waiting, and put on the list when due.

const tables: Record<string, Row[]> = {}
const db = fakeSupabase(tables) as never

// Sat 24 Oct 2026, 3pm in Perth
const NOW = new Date('2026-10-24T07:00:00Z')

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  tables.jobs = [{ id: 'j1', tenant_id: 't1', job_number: 'IRC1001' }]
})

describe('when a follow-up is due', () => {
  it('reads days, weeks, months and dates as 8am Perth that day', () => {
    expect(parseFollowUpWhen('7', NOW)).toBe('2026-10-31T00:00:00.000Z')
    expect(parseFollowUpWhen(7, NOW)).toBe('2026-10-31T00:00:00.000Z')
    expect(parseFollowUpWhen('in 3 days', NOW)).toBe('2026-10-27T00:00:00.000Z')
    expect(parseFollowUpWhen('2 weeks', NOW)).toBe('2026-11-07T00:00:00.000Z')
    expect(parseFollowUpWhen('1 month', NOW)).toBe('2026-11-24T00:00:00.000Z')
    expect(parseFollowUpWhen('2026-11-02', NOW)).toBe('2026-11-02T00:00:00.000Z')
    expect(parseFollowUpWhen('2026-11-02T14:00', NOW)).toBe('2026-11-02T06:00:00.000Z')
    expect(parseFollowUpWhen('whenever', NOW)).toBeNull()
    expect(parseFollowUpWhen('0', NOW)).toBeNull()
  })

  it('offers 3 days, a week, two weeks and a month, and says the day', () => {
    expect(followUpPresets(NOW).map(p => p.label)).toEqual(['In 3 days', 'In a week', 'In 2 weeks', 'In a month'])
    expect(spokenDue('2026-10-31T00:00:00.000Z')).toBe('Sat 31 Oct')
    expect(spokenDue('2026-11-02T06:00:00.000Z')).toBe('Mon 2 Nov, 2:00 pm')
  })
})

describe('setting and changing follow-ups', () => {
  const due = () => new Date(Date.now() + 7 * 86_400_000).toISOString()

  it('sets one as a scheduled card and can take the card it came from off the list', async () => {
    tables.action_queue = [{ id: 'k1', tenant_id: 't1', source: 'email', source_ref: 'th1', status: 'pending', steps: [] }]
    const card = await createFollowUp(db, 't1', 'u1', { jobId: 'j1', note: 'Chase the roof quote', who: 'Ace Roofing', dueAt: due(), threadId: 'abc1', fromCardId: 'k1', clearCard: true })
    expect(card).toMatchObject({
      source: 'followup', status: 'scheduled', job_id: 'j1', title: 'Follow up with Ace Roofing: Chase the roof quote',
      follow_up: { note: 'Chase the roof quote', who: 'Ace Roofing', thread_id: 'abc1', from_card_id: 'k1', created_by: 'u1' },
    })
    expect(tables.action_queue[0]).toMatchObject({ status: 'done', outcome: expect.stringMatching(/^Follow-up set for /) })
  })

  it('refuses no note, a time in the past, or another company\'s job', async () => {
    await expect(createFollowUp(db, 't1', 'u1', { jobId: null, note: ' ', dueAt: due() })).rejects.toThrow(/What should/)
    await expect(createFollowUp(db, 't1', 'u1', { jobId: null, note: 'x', dueAt: '2020-01-01T00:00:00Z' })).rejects.toThrow(/future/)
    await expect(createFollowUp(db, 't2', 'u1', { jobId: 'j1', note: 'x', dueAt: due() })).rejects.toMatchObject({ status: 404 })
  })

  it('moves, rewords and cancels one while it waits', async () => {
    const card = await createFollowUp(db, 't1', 'u1', { jobId: null, note: 'Call Jo', dueAt: due() })
    const later = new Date(Date.now() + 14 * 86_400_000).toISOString()
    const moved = await updateFollowUp(db, 't1', card.id, { dueAt: later, who: 'Jo at Allianz' })
    expect(moved).toMatchObject({ due_at: later, title: 'Follow up with Jo at Allianz: Call Jo', follow_up: { note: 'Call Jo', who: 'Jo at Allianz' } })
    expect(await cancelFollowUp(db, 't1', card.id, 'u1')).toBe(true)
    expect(await cancelFollowUp(db, 't1', card.id, 'u1')).toBe(false)
    await expect(updateFollowUp(db, 't1', card.id, { note: 'x' })).rejects.toMatchObject({ status: 409 })
  })

  it('puts due follow-ups on the list for the AI to draft, and leaves the rest waiting', async () => {
    tables.action_queue = [
      { id: 'a', status: 'scheduled', due_at: '2026-10-24T00:00:00.000Z', attempts: 2 },
      { id: 'b', status: 'scheduled', due_at: '2026-11-24T00:00:00.000Z' },
      { id: 'c', status: 'pending', due_at: '2026-10-01T00:00:00.000Z' },
    ]
    expect(await releaseDueFollowUps(db, NOW)).toBe(1)
    expect(tables.action_queue.map(r => r.status)).toEqual(['queued', 'scheduled', 'pending'])
    expect(tables.action_queue[0].attempts).toBe(0)
  })
})

describe('to-dos a person adds', () => {
  it('puts a reminder on the list now, in their words, with no AI', async () => {
    const card = await createFollowUp(db, 't1', 'u1', { jobId: 'j1', note: 'Ring Brett about the excess', dueAt: '', todo: { mode: 'remind' } })
    expect(card).toMatchObject({ source: 'followup', rule_key: 'todo_remind', status: 'pending', title: 'Ring Brett about the excess', description: null, job_id: 'j1', follow_up: { kind: 'todo', todo: { mode: 'remind' }, created_by: 'u1' } })
  })

  it('has the AI draft the steps of one to do now, and keeps a long note as the summary', async () => {
    const note = 'Send Castle the revised scope\nThey asked on the phone for the fascia to be added'
    const card = await createFollowUp(db, 't1', 'u1', { jobId: null, note, dueAt: '', todo: { mode: 'do' }, urgent: true })
    expect(card).toMatchObject({ status: 'queued', rule_key: 'todo_do', title: 'Send Castle the revised scope', description: note, priority: 90 })
  })

  it('waits for its day, then a reminder comes on as it is and one to do goes to the AI', async () => {
    const day = new Date(Date.now() + 3 * 86_400_000).toISOString()
    await createFollowUp(db, 't1', 'u1', { jobId: null, note: 'Order the tiles', dueAt: day, todo: { mode: 'remind' } })
    await createFollowUp(db, 't1', 'u1', { jobId: null, note: 'Email the plumber for a booking', dueAt: day, todo: { mode: 'do' } })
    expect(tables.action_queue.map(r => r.status)).toEqual(['scheduled', 'scheduled'])
    expect(await releaseDueFollowUps(db, new Date(Date.now() + 4 * 86_400_000))).toBe(2)
    expect(tables.action_queue.map(r => r.status)).toEqual(['pending', 'queued'])
  })

  it('needs something to do', async () => {
    await expect(createFollowUp(db, 't1', 'u1', { jobId: null, note: '  ', dueAt: '', todo: { mode: 'remind' } })).rejects.toThrow('What\'s the to-do?')
  })
})
