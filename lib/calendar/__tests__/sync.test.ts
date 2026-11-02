import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from '@/lib/mcp/__tests__/fake-supabase'
import { eventRow, jobNumbersIn, linkEvents, plainLink, streetKey, syncCalendar } from '../sync'

// The office's calendar linked to jobs: events copied in from Google (only
// changes after the first read), then linked by job number, inspection,
// address or — for the rest — the AI reading them beside the jobs' notes.
// A job's appointment booked after its order counts as booked.

const tables: Record<string, Row[]> = {}
const rpc = vi.fn(async () => ({ data: null, error: null }))
const db = () => Object.assign(fakeSupabase(tables), { rpc }) as never

const NOW = new Date('2026-11-02T02:00:00Z')

const job = (o: Row): Row => ({ tenant_id: 't1', insured_name: null, insurer: 'Castle', current_stage: 'awaiting_schedule', created_at: '2026-10-20T00:00:00Z', kpi_started_at: '2026-10-30T04:17:00Z', kpi_visited_at: null, kpi_booked_at: null, ...o })
const event = (o: Row): Row => ({ tenant_id: 't1', calendar_id: 'cal', status: 'confirmed', all_day: false, etag: 'e1', linked_etag: null, link_source: null, job_id: null, description: null, location: null, google_created_at: '2026-10-30T06:45:00Z', start_at: '2026-10-31T05:00:00Z', ...o })

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  rpc.mockClear()
  tables.jobs = [
    job({ id: 'j79', job_number: 'IRC1079', property_address: '187C Leake Street, Belmont, WA 6104' }),
    job({ id: 'j78', job_number: 'IRC1078', property_address: '4 Ardisia Way, Woodvale WA 6026', kpi_booked_at: '2026-10-29T00:00:00Z' }),
  ]
  tables.inspections = [{ tenant_id: 't1', job_id: 'j78', calendar_event_id: 'g-insp' }]
})

describe('reading events', () => {
  it('finds job numbers and street addresses', () => {
    expect(jobNumbersIn('IRC1078 inspection — re irc1079 and J76364')).toEqual(['IRC1078', 'IRC1079', 'J76364'])
    expect(streetKey('187C Leake Street, Belmont, WA 6104')).toBe('187c leake')
    expect(streetKey('Belmont WA 6104')).toBeNull()
    expect(streetKey('IRC1078 inspection - 4 Ardisia Way, Woodvale')).toBe('4 ardisia')
  })

  it('keeps a Google event\'s times, all-day events as the Perth day', () => {
    expect(eventRow({ id: 'g1', etag: 'x', summary: 'Belmont job', start: { dateTime: '2026-10-31T13:00:00+08:00' }, end: { dateTime: '2026-10-31T14:00:00+08:00' } })).toMatchObject({ google_event_id: 'g1', start_at: '2026-10-31T05:00:00.000Z', end_at: '2026-10-31T06:00:00.000Z', all_day: false })
    expect(eventRow({ id: 'g2', start: { date: '2026-11-05' }, end: { date: '2026-11-06' } })).toMatchObject({ start_at: '2026-11-04T16:00:00.000Z', all_day: true })
  })

  it('reads the last month the first time, then only changes, starting over when the token expires', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ data: { items: [{ id: 'g1', etag: 'a', summary: 'Belmont job', start: { dateTime: '2026-10-31T13:00:00+08:00' } }], nextSyncToken: 's1' } })
      .mockResolvedValueOnce({ data: { items: [{ id: 'g1', etag: 'b', summary: 'Belmont job (moved)', start: { dateTime: '2026-10-31T14:00:00+08:00' } }, { id: 'g9', status: 'cancelled' }], nextSyncToken: 's2' } })
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 410 }))
      .mockResolvedValueOnce({ data: { items: [], nextSyncToken: 's3' } })
    const calendar = { events: { list } } as never
    await syncCalendar(db(), calendar, 't1', 'cal')
    expect(list.mock.calls[0][0]).toMatchObject({ calendarId: 'cal', timeMin: expect.any(String) })
    await syncCalendar(db(), calendar, 't1', 'cal')
    expect(list.mock.calls[1][0]).toMatchObject({ syncToken: 's1' })
    expect(tables.calendar_events).toHaveLength(1)
    expect(tables.calendar_events[0]).toMatchObject({ summary: 'Belmont job (moved)', etag: 'b' })
    await syncCalendar(db(), calendar, 't1', 'cal')
    expect(list.mock.calls[3][0]).not.toHaveProperty('syncToken')
    expect(tables.calendar_sync_state[0]).toMatchObject({ sync_token: 's3' })
  })
})

describe('linking events to jobs', () => {
  it('links by job number, the inspection it was made for, or one job at that address', () => {
    const jobs = tables.jobs as never
    const insp = new Map([['g-insp', 'j78']])
    expect(plainLink({ google_event_id: 'x', summary: 'IRC1079 site meeting', description: null, location: null }, jobs, insp)).toMatchObject({ source: 'job_number', job: { id: 'j79' } })
    expect(plainLink({ google_event_id: 'g-insp', summary: 'Inspection', description: null, location: null }, jobs, insp)).toMatchObject({ source: 'inspection', job: { id: 'j78' } })
    expect(plainLink({ google_event_id: 'y', summary: 'Inspection', description: null, location: '4 Ardisia Way, Woodvale WA 6026' }, jobs, insp)).toMatchObject({ source: 'address', job: { id: 'j78' } })
    expect(plainLink({ google_event_id: 'z', summary: 'Belmont job (new order)', description: null, location: 'Belmont WA 6104' }, jobs, insp)).toBeNull()
  })

  it('has the AI match the rest from the job notes, leaves personal events unlinked, and counts a job\'s appointment as booked', async () => {
    tables.communications = [{ tenant_id: 't1', job_id: 'j79', type: 'note', content: 'Inspection tomorrow, Saturday 31 October, arrival window 1 to 2 pm.', created_at: '2026-10-30T05:00:00Z' }]
    tables.calendar_events = [
      event({ id: 'c1', google_event_id: 'g1', summary: 'Belmont job (new order)', location: 'Belmont WA 6104' }),
      event({ id: 'c2', google_event_id: 'g2', summary: 'Gym', start_at: '2026-11-01T22:00:00Z' }),
      event({ id: 'c3', google_event_id: 'g3', summary: 'IRC1078 inspection', linked_etag: 'e1', job_id: 'j78', link_source: 'job_number' }),
    ]
    const create = vi.fn(async () => ({ content: [{ type: 'tool_use', id: 't', name: 'link_events', input: { links: [
      { event: 'E1', job_number: 'IRC1079', reason: 'Belmont, Sat 1pm — matches the note on IRC1079' },
      { event: 'E2', job_number: '', reason: 'Personal' },
    ] } }] }))
    const out = await linkEvents(db(), 't1', { client: { beta: { messages: { create } } } as never, at: NOW })
    expect(out).toEqual({ linked: 1, read: 2 })
    expect(tables.calendar_events.map(e => [e.id, e.job_id, e.link_source])).toEqual([['c1', 'j79', 'ai'], ['c2', null, 'none'], ['c3', 'j78', 'job_number']])
    const prompt = (create.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0].content
    expect(prompt).toContain('E1: Sat 31 Oct, 1:00 pm — "Belmont job (new order)" at Belmont WA 6104')
    expect(prompt).toContain('note Fri 30 Oct, 1:00 pm: Inspection tomorrow, Saturday 31 October')
    expect(rpc).toHaveBeenCalledWith('jobs_kpi_mark', { p_job: 'j79', p_milestone: 'booked', p_at: '2026-10-30T06:45:00Z' })
    // Nothing changed: nothing read again
    expect(await linkEvents(db(), 't1', { client: { beta: { messages: { create } } } as never, at: NOW })).toEqual({ linked: 0, read: 0 })
  })

  it('doesn\'t count a site meeting long after the visit, or one booked before the order, as the booking', async () => {
    tables.jobs[0].kpi_visited_at = '2026-10-31T06:47:00Z'
    tables.calendar_events = [
      event({ id: 'c1', google_event_id: 'g1', summary: 'IRC1079 tiles meeting', start_at: '2026-11-20T02:00:00Z' }),
      event({ id: 'c2', google_event_id: 'g2', summary: 'IRC1079 early', google_created_at: '2026-10-01T00:00:00Z' }),
    ]
    await linkEvents(db(), 't1', { at: NOW })
    expect(tables.calendar_events.map(e => e.job_id)).toEqual(['j79', 'j79'])
    expect(rpc).not.toHaveBeenCalled()
  })
})
