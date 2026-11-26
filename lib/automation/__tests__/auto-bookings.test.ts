import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'

// Done for you: a trade's day from an email the office sent goes on the
// schedule by itself, kept with what was there before; Undo puts it back and
// is recorded for the learning module.

const tables: Record<string, Row[]> = {}
const events: Row[] = []
vi.mock('@/lib/activity/log', () => ({ recordSystemEvent: async (e: Row) => { events.push(e) } }))
vi.mock('@/lib/learning/lessons', () => ({ activeLessons: async () => [], formatLessons: () => '' }))

const { applyEmailBookings, undoAutoAction, listAutoActions } = await import('../auto-bookings')
const db = () => fakeSupabase(tables) as never
const apply = (bookings: Row[]) => applyEmailBookings(db(), { tenantId: 't1', jobId: 'j79', jobNumber: 'IRC1079', messageId: 'm1', to: { email: 'dave@brushbros.com.au' }, bookings: bookings as never })

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  events.length = 0
  tables.jobs = [{ id: 'j79', tenant_id: 't1', job_number: 'IRC1079' }]
  tables.trades = [{ id: 'tp', tenant_id: 't1', business_name: 'Brush Bros', primary_contact: 'Dave' }, { id: 'tc', tenant_id: 't1', business_name: 'Joinery WA', primary_contact: null }]
  tables.work_orders = [
    { id: 'wp', tenant_id: 't1', job_id: 'j79', trade_name: 'Painter', trade_id: 'tp', total_visits: 1, status: 'engaged' },
    { id: 'wc', tenant_id: 't1', job_id: 'j79', trade_name: 'Carpenter', trade_id: 'tc', total_visits: 1, status: 'engaged' },
  ]
  tables.work_order_visits = []
  tables.auto_actions = []
  tables.learning_events = []
})

describe('applyEmailBookings', () => {
  it('books the trade from the office\'s words, keeps what it did, tells the job and records it for learning', async () => {
    const out = await apply([{ trade: 'painter', start_date: '2026-12-01', end_date: '2026-12-03', start_time: '7:00', evidence: 'Dave will be there Tuesday to Thursday from 7' }])
    expect(out).toEqual(['Booked the Painter (Brush Bros) on IRC1079 for Tue 1 Dec to Thu 3 Dec at 07:00'])
    expect(tables.work_order_visits[0]).toMatchObject({ work_order_id: 'wp', scheduled_date: '2026-12-01', scheduled_end_date: '2026-12-03', start_time: '07:00', status: 'confirmed' })
    expect(tables.auto_actions[0]).toMatchObject({ kind: 'trade_visit', source: 'sent_email', source_ref: 'm1', job_id: 'j79', before: null,
      after: { start_date: '2026-12-01', end_date: '2026-12-03', start_time: '07:00' }, target: { work_order_id: 'wp', visit_number: 1 }, evidence: 'Dave will be there Tuesday to Thursday from 7' })
    expect(events[0]).toMatchObject({ event: 'schedule.auto', jobId: 'j79', summary: expect.stringContaining('from your email') })
    expect(tables.learning_events[0]).toMatchObject({ feature: 'auto_booking', outcome: 'accepted', situation: { recipient_email: 'dave@brushbros.com.au', trade: 'painter' } })
  })

  it('leaves alone what is already on the schedule, a trade it can\'t place, and a day that isn\'t a date', async () => {
    await apply([{ trade: 'painter', start_date: '2026-12-01', evidence: 'x' }])
    expect(await apply([{ trade: 'painter', start_date: '2026-12-01', evidence: 'x' }])).toEqual(['Painter (Brush Bros) Tue 1 Dec: already on the schedule'])
    expect(await apply([{ trade: 'plumber', start_date: '2026-12-02', evidence: 'x' }])).toEqual(['plumber Wed 2 Dec: not booked — no work order for it'])
    expect(await apply([{ trade: 'carpenter', start_date: 'next week', evidence: 'x' }])).toEqual([])
    expect(tables.auto_actions).toHaveLength(1)
  })
})

describe('undoAutoAction', () => {
  it('takes a new booking off again, and a move back to the day it had, recording why', async () => {
    await apply([{ trade: 'painter', start_date: '2026-12-01', evidence: 'x' }])
    const first = tables.auto_actions[0].id as string
    await undoAutoAction(db(), 't1', first, 'u1', 'That was the homeowner\'s idea, not agreed')
    expect(tables.work_order_visits[0]).toMatchObject({ scheduled_date: null, status: 'unscheduled' })
    expect(tables.auto_actions[0]).toMatchObject({ status: 'undone', undone_by: 'u1' })
    expect(tables.learning_events.at(-1)).toMatchObject({ outcome: 'instructed', instruction: 'That was the homeowner\'s idea, not agreed', situation: { recipient_email: 'dave@brushbros.com.au' } })
    await expect(undoAutoAction(db(), 't1', first, 'u1')).rejects.toThrow('already undone')

    // A move: back to Monday at 8
    Object.assign(tables.work_order_visits[0], { scheduled_date: '2026-11-30', start_time: '08:00', status: 'confirmed' })
    await applyEmailBookings(db(), { tenantId: 't1', jobId: 'j79', jobNumber: 'IRC1079', messageId: 'm2', to: null, bookings: [{ trade: 'Brush Bros', start_date: '2026-12-04', evidence: 'moving Dave to Friday' }] })
    const moved = tables.auto_actions.find(a => a.source_ref === 'm2')!
    expect(moved.summary).toBe('Moved the Painter (Brush Bros) on IRC1079 for Fri 4 Dec at 08:00 (was Mon 30 Nov at 08:00)')
    await undoAutoAction(db(), 't1', moved.id as string, 'u1')
    expect(tables.work_order_visits[0]).toMatchObject({ scheduled_date: '2026-11-30', start_time: '08:00' })
    expect(tables.learning_events.at(-1)).toMatchObject({ outcome: 'skipped' })
  })

  it('lists the latest with their job numbers', async () => {
    await apply([{ trade: 'painter', start_date: '2026-12-01', evidence: 'x' }])
    tables.auto_actions[0].created_at = new Date().toISOString() // the stand-in stamps a fixed date
    expect((await listAutoActions(db(), 't1')).map(a => a.job_number)).toEqual(['IRC1079'])
  })
})
