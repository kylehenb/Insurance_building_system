import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeSupabase, type Row } from './fake-supabase'

// book_trade_visit and get_schedule: a trade's firm day(s) on site go on the
// work order's visit, and "what's on Thursday?" reads back inspections,
// trades on site and job appointments — narrowed by kind, trade or person.

const tables: Record<string, Row[]> = {}
vi.mock('@/lib/mcp/tools/excess', () => ({
  isToolResult: (v: unknown) => !!v && typeof v === 'object' && 'text' in v,
  jobFromArgs: async (args: Row) => {
    const job = tables.jobs.find(j => j.job_number === args.job_number)
    return job ? { id: job.id, job_number: job.job_number } : { text: 'No job found.', isError: true }
  },
}))

const { bookTradeVisit, getSchedule, listUnbooked } = await import('../tools/schedule')
const { inspectionKind, scheduleByDay } = await import('@/lib/schedule/schedule')
const ctx = (userId = 'u1') => ({ supabase: fakeSupabase(tables) as never, tenantId: 't1', userId })

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  tables.users = [{ id: 'u1', tenant_id: 't1', name: 'Kyle Bindon' }, { id: 'u2', tenant_id: 't1', name: 'Sam Lee' }]
  tables.jobs = [
    { id: 'j79', tenant_id: 't1', job_number: 'IRC1079', property_address: '187C Leake Street, Belmont, WA 6104', insurer: 'Suncorp', assigned_to: null },
    { id: 'j81', tenant_id: 't1', job_number: 'IRC1081', property_address: '4 King Street, Bayswater, WA 6053', insurer: 'AAI', assigned_to: 'u2' },
    { id: 'jm', tenant_id: 't1', job_number: 'MC0001', property_address: '1 Other St', insurer: 'Midcity', assigned_to: null },
  ]
  tables.trades = [
    { id: 'tp', tenant_id: 't1', business_name: 'Brush Bros', primary_trade: 'Painter', primary_contact: 'Dave' },
    { id: 'te', tenant_id: 't1', business_name: 'Sparky Co', primary_trade: 'Electrician', primary_contact: 'Lee' },
  ]
  tables.work_orders = [
    { id: 'wp', tenant_id: 't1', job_id: 'j79', trade_name: 'Painter', trade_id: 'tp', total_visits: 1, status: 'engaged' },
    { id: 'we', tenant_id: 't1', job_id: 'j79', trade_name: 'Electrician', trade_id: 'te', total_visits: 2, status: 'engaged' },
    { id: 'w81', tenant_id: 't1', job_id: 'j81', trade_name: 'Painter', trade_id: 'tp', total_visits: 1, status: 'engaged' },
  ]
  tables.work_order_visits = [
    { id: 've1', tenant_id: 't1', job_id: 'j79', work_order_id: 'we', visit_number: 1, status: 'unscheduled', scheduled_date: null, scheduled_end_date: null },
    { id: 've2', tenant_id: 't1', job_id: 'j79', work_order_id: 'we', visit_number: 2, status: 'unscheduled', scheduled_date: null, scheduled_end_date: null },
  ]
  tables.inspections = []
  tables.reports = []
  tables.calendar_events = []
})

describe('book_trade_visit', () => {
  it('books a trade over several days, making the visit when the work order has none', async () => {
    const out = await bookTradeVisit.run({ job_number: 'IRC1079', trade: 'painter', start_date: '2026-12-01', end_date: '2026-12-03', note: '7am start' }, ctx())
    expect(out.isError).toBeUndefined()
    expect(out.text).toBe('Booked the Painter (Brush Bros) on IRC1079 for Tue 1 Dec to Thu 3 Dec (3 days).')
    expect(tables.work_order_visits.find(v => v.work_order_id === 'wp')).toMatchObject({
      visit_number: 1, job_id: 'j79', status: 'confirmed', scheduled_date: '2026-12-01', scheduled_end_date: '2026-12-03', confirmed_date: '2026-12-01', notes: '7am start',
    })
  })

  it('books the next unbooked visit, then moves one when asked, saying what it was', async () => {
    expect((await bookTradeVisit.run({ job_number: 'IRC1079', trade: 'Sparky', start_date: '2026-12-01' }, ctx())).text).toBe('Booked the Electrician (Sparky Co) visit 1 of 2 on IRC1079 for Tue 1 Dec.')
    expect((await bookTradeVisit.run({ job_number: 'IRC1079', trade: 'electrician', start_date: '2026-12-08' }, ctx())).text).toBe('Booked the Electrician (Sparky Co) visit 2 of 2 on IRC1079 for Tue 8 Dec.')
    // Both booked: which one is moving?
    expect(await bookTradeVisit.run({ job_number: 'IRC1079', trade: 'electrician', start_date: '2026-12-09' }, ctx())).toMatchObject({ isError: true, text: expect.stringContaining('which one is moving?') })
    expect((await bookTradeVisit.run({ job_number: 'IRC1079', trade: 'electrician', start_date: '2026-12-09', visit_number: 2 }, ctx())).text).toBe('Moved the Electrician (Sparky Co) visit 2 of 2 on IRC1079 for Wed 9 Dec (was Tue 8 Dec).')
    expect(tables.work_order_visits.find(v => v.id === 've2')).toMatchObject({ scheduled_date: '2026-12-09', scheduled_end_date: null })
  })

  it('is all day unless a time is given; a moved visit keeps its time', async () => {
    // Cabinets: electrician disconnects at 7, painter all day, reconnect first thing next morning
    expect((await bookTradeVisit.run({ job_number: 'IRC1079', trade: 'electrician', start_date: '2026-12-03', start_time: '7:00' }, ctx())).text).toBe('Booked the Electrician (Sparky Co) visit 1 of 2 on IRC1079 for Thu 3 Dec at 7:00 am.')
    expect((await bookTradeVisit.run({ job_number: 'IRC1079', trade: 'painter', start_date: '2026-12-03' }, ctx())).text).toBe('Booked the Painter (Brush Bros) on IRC1079 for Thu 3 Dec.')
    await bookTradeVisit.run({ job_number: 'IRC1079', trade: 'electrician', start_date: '2026-12-04', start_time: '07:00' }, ctx())
    expect(tables.work_order_visits.find(v => v.id === 've1')).toMatchObject({ start_time: '07:00' })
    expect(tables.work_order_visits.find(v => v.work_order_id === 'wp')).toMatchObject({ start_time: null })
    // Moved to another day: keeps 7am; then made all day
    expect((await bookTradeVisit.run({ job_number: 'IRC1079', trade: 'electrician', visit_number: 2, start_date: '2026-12-07' }, ctx())).text).toBe('Moved the Electrician (Sparky Co) visit 2 of 2 on IRC1079 for Mon 7 Dec at 7:00 am (was Fri 4 Dec at 7:00 am).')
    await bookTradeVisit.run({ job_number: 'IRC1079', trade: 'electrician', visit_number: 2, start_date: '2026-12-07', all_day: true }, ctx())
    expect(tables.work_order_visits.find(v => v.id === 've2')).toMatchObject({ start_time: null })
    expect(await bookTradeVisit.run({ job_number: 'IRC1079', trade: 'painter', start_date: '2026-12-03', start_time: 'early' }, ctx())).toMatchObject({ isError: true })
    // On the schedule: all-day first, then by time
    const day = await getSchedule.run({ from: '2026-12-03' }, ctx())
    expect(day.text).toBe(['Thu 3 Dec:', '- Painter (Brush Bros) — IRC1079, 187C Leake Street, Belmont', '- 7:00 am Electrician (Sparky Co), visit 1 of 2 — IRC1079, 187C Leake Street, Belmont'].join('\n'))
  })

  it('clears a booking back to unscheduled', async () => {
    await bookTradeVisit.run({ job_number: 'IRC1079', trade: 'painter', start_date: '2026-12-01' }, ctx())
    const out = await bookTradeVisit.run({ job_number: 'IRC1079', trade: 'painter', clear: true }, ctx())
    expect(out.text).toBe('Took the Painter (Brush Bros) off the schedule for IRC1079 (was Tue 1 Dec).')
    expect(tables.work_order_visits.find(v => v.work_order_id === 'wp')).toMatchObject({ status: 'unscheduled', scheduled_date: null, confirmed_date: null })
  })

  it('wants a firm day and a trade it can tell apart', async () => {
    expect(await bookTradeVisit.run({ job_number: 'IRC1079', trade: 'painter', start_date: 'next week' }, ctx())).toMatchObject({ isError: true, text: expect.stringMatching(/firm date/) })
    expect(await bookTradeVisit.run({ job_number: 'IRC1079', start_date: '2026-12-01' }, ctx())).toMatchObject({ isError: true, text: 'Which trade on IRC1079? It has: Painter (Brush Bros), Electrician (Sparky Co).' })
    expect(await bookTradeVisit.run({ job_number: 'IRC1079', trade: 'painter', start_date: '2026-12-05', end_date: '2026-12-01' }, ctx())).toMatchObject({ isError: true, text: 'The last day is before the first.' })
  })
})

describe('get_schedule', () => {
  beforeEach(async () => {
    await bookTradeVisit.run({ job_number: 'IRC1079', trade: 'painter', start_date: '2026-12-01', end_date: '2026-12-03' }, ctx())
    await bookTradeVisit.run({ job_number: 'IRC1081', trade: 'painter', start_date: '2026-12-02' }, ctx())
    tables.inspections.push(
      { id: 'i1', tenant_id: 't1', job_id: 'j79', report_id: 'r1', inspector_id: null, scheduled_date: '2026-12-02', start_time: '08:00:00', finish_time: '09:00:00', status: 'appointment_confirmed', calendar_event_id: 'g-insp' },
      { id: 'i2', tenant_id: 't1', job_id: 'j81', report_id: null, inspector_id: 'u2', scheduled_date: '2026-12-02', start_time: '13:00:00', finish_time: null, status: 'appointment_confirmed', calendar_event_id: null },
      { id: 'im', tenant_id: 't1', job_id: 'jm', report_id: null, inspector_id: null, scheduled_date: '2026-12-02', start_time: '10:00:00', status: 'appointment_confirmed', calendar_event_id: null },
    )
    tables.reports.push({ id: 'r1', tenant_id: 't1', inspection_id: 'i1', report_type: 'BAR' }, { id: 'r2', tenant_id: 't1', inspection_id: 'i2', report_type: 'make_safe' })
    tables.calendar_events.push(
      // The inspection's own event: shown once, as the inspection
      { id: 'c1', tenant_id: 't1', google_event_id: 'g-insp', job_id: 'j79', summary: 'Inspection — IRC1079', start_at: '2026-12-02T00:00:00Z', end_at: '2026-12-02T01:00:00Z', all_day: false, status: 'confirmed' },
      { id: 'c2', tenant_id: 't1', google_event_id: 'g-meet', job_id: 'j79', summary: 'Site meeting with the homeowner', start_at: '2026-12-02T06:30:00Z', end_at: '2026-12-02T07:00:00Z', all_day: false, status: 'confirmed' },
      { id: 'c3', tenant_id: 't1', google_event_id: 'g-dentist', job_id: null, summary: 'Dentist', start_at: '2026-12-02T02:00:00Z', end_at: '2026-12-02T03:00:00Z', all_day: false, status: 'confirmed' },
    )
  })

  it('reads a day: trades on site first, then by time; work over several days says which day; Midcity and personal events stay out', async () => {
    const out = await getSchedule.run({ from: '2026-12-02' }, ctx())
    expect(out.text).toBe([
      'Wed 2 Dec:',
      '- Painter (Brush Bros) — IRC1079, 187C Leake Street, Belmont — day 2 of 3',
      '- Painter (Brush Bros) — IRC1081, 4 King Street, Bayswater [Sam Lee]',
      '- 8:00 am Inspection — IRC1079, 187C Leake Street, Belmont',
      '- 1:00 pm Make safe with Sam Lee — IRC1081, 4 King Street, Bayswater [Sam Lee]',
      '- 2:30 pm Site meeting with the homeowner — IRC1079, 187C Leake Street, Belmont',
    ].join('\n'))
  })

  it('stacks the filters: a kind, then a person ("me" includes jobs nobody has been given)', async () => {
    expect((await getSchedule.run({ from: '2026-12-01', to: '2026-12-03', kinds: ['repair'], person: 'me' }, ctx())).text).toBe([
      'Tue 1 Dec to Thu 3 Dec (repair, yours):',
      'Tue 1 Dec:', '- Painter (Brush Bros) — IRC1079, 187C Leake Street, Belmont — day 1 of 3',
      'Wed 2 Dec:', '- Painter (Brush Bros) — IRC1079, 187C Leake Street, Belmont — day 2 of 3',
      'Thu 3 Dec:', '- Painter (Brush Bros) — IRC1079, 187C Leake Street, Belmont — day 3 of 3',
    ].join('\n'))
    const sams = await getSchedule.run({ from: '2026-12-02', person: 'Sam' }, ctx())
    expect((sams.data as { entries: { job_number: string }[] }).entries.map(e => e.job_number)).toEqual(['IRC1081', 'IRC1081'])
    const inspections = await getSchedule.run({ from: '2026-12-02', kinds: ['inspection', 'make_safe'] }, ctx())
    expect((inspections.data as { entries: { kind: string }[] }).entries.map(e => e.kind)).toEqual(['inspection', 'make_safe'])
  })

  it('narrows to a trade or a job, and says when nothing is on', async () => {
    const painter = await getSchedule.run({ from: '2026-12-01', to: '2026-12-07', trade: 'brush', job_number: 'IRC1081' }, ctx())
    expect((painter.data as { entries: unknown[] }).entries).toHaveLength(1)
    expect((await getSchedule.run({ from: '2026-12-10' }, ctx())).text).toBe('Nothing on the schedule for Thu 10 Dec.')
  })
})

describe('schedule helpers', () => {
  it('names an inspection by its report', () => {
    expect(['BAR', 'make_safe', 'roof_report', 'LDR', 'specialist', null].map(inspectionKind)).toEqual(['inspection', 'make_safe', 'roof', 'leak_detection', 'specialist', 'inspection'])
  })
  it('puts work over several days on each of its days', () => {
    const e = { kind: 'repair', start_date: '2026-12-01', end_date: '2026-12-02' } as never
    expect(scheduleByDay([e], '2026-11-30', '2026-12-02').map(d => d.entries.length)).toEqual([0, 1, 1])
  })
})

describe('list_unbooked', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-26T02:00:00Z'))
    Object.assign(tables.jobs[0], { phase: 'in_repair', phase_step: 'book_trades', phase_since: '2026-11-01T00:00:00Z', insured_name: 'Jane Smith' })
    Object.assign(tables.jobs[1], { phase: 'in_repair', phase_step: 'awaiting_signature', phase_since: '2026-11-10T00:00:00Z' })
    tables.jobs.push(
      { id: 'j90', tenant_id: 't1', job_number: 'IRC1090', property_address: '12 Smith Street, Bayswater, WA 6053', insured_name: 'Pat Lee', insurer: 'Suncorp', assigned_to: null, phase: 'assessment', phase_step: 'book_inspection', kpi_booking_due: '2026-11-25T07:00:00Z' },
      { id: 'j91', tenant_id: 't1', job_number: 'IRC1091', property_address: '9 Hill Road, Maylands, WA 6051', insured_name: null, insurer: 'AAI', assigned_to: 'u2', phase: 'assessment', phase_step: 'book_inspection', kpi_booking_due: '2026-11-30T07:00:00Z' },
      { id: 'j92', tenant_id: 't1', job_number: 'IRC1092', property_address: '1 On Hold St', insurer: 'AAI', assigned_to: null, phase: 'assessment', phase_step: 'book_inspection', override_stage: 'on_hold' },
    )
    Object.assign(tables.work_orders[0], { gary_state: 'waiting_reply' }) // painter sent
    Object.assign(tables.work_orders[1], { gary_state: 'not_started' }) // electrician not sent
  })
  afterEach(() => { vi.useRealTimers() })

  it('lists inspections by deadline (overdue said), trades by job, and jobs still waiting on a signature', async () => {
    const out = await listUnbooked.run({}, ctx())
    expect(out.text).toBe([
      'Not booked yet:',
      'Inspections to book (2):',
      '- IRC1090, 12 Smith Street, Bayswater (Pat Lee) — booking was due Wed 25 Nov, 3:00 pm (overdue)',
      '- IRC1091, 9 Hill Road, Maylands — booking due Mon 30 Nov, 3:00 pm [Sam Lee]',
      'Trades to book on 1 job ready for work:',
      '- IRC1079, 187C Leake Street, Belmont: Painter (Brush Bros); Electrician (Sparky Co), visits 1 and 2 of 2 — not sent yet',
      'Still waiting on the homeowner\'s signature before trades (1): IRC1081 [Sam Lee].',
    ].join('\n'))
  })

  it('drops a visit once it has a date, and narrows to a person or to trades', async () => {
    await bookTradeVisit.run({ job_number: 'IRC1079', trade: 'painter', start_date: '2026-12-01' }, ctx())
    await bookTradeVisit.run({ job_number: 'IRC1079', trade: 'electrician', start_date: '2026-12-01' }, ctx())
    const trades = await listUnbooked.run({ what: 'trades' }, ctx())
    expect(trades.text).toContain('- IRC1079, 187C Leake Street, Belmont: Electrician (Sparky Co), visit 2 of 2 — not sent yet')
    expect(trades.text).not.toContain('Inspections')
    const sams = await listUnbooked.run({ person: 'Sam' }, ctx())
    expect((sams.data as { inspections: { job_number: string }[] }).inspections.map(i => i.job_number)).toEqual(['IRC1091'])
    const mine = await listUnbooked.run({ person: 'me', what: 'inspections' }, ctx())
    expect((mine.data as { inspections: { job_number: string }[] }).inspections.map(i => i.job_number)).toEqual(['IRC1090'])
  })
})
