import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from './fake-supabase'

// add_job_appointment: "put it in my calendar" — the event goes on the
// office's calendar with the job number and address (so it's linked to the
// job for certain), and the note, if any, onto the job.

const tables: Record<string, Row[]> = {}
const insert = vi.fn()
vi.mock('@/lib/calendar/client', () => ({ getCalendarClient: () => ({ events: { insert } }) }))
vi.mock('@/lib/mcp/tools/excess', () => ({
  isToolResult: (v: unknown) => !!v && typeof v === 'object' && 'text' in v,
  jobFromArgs: async (args: Row) => (args.job_number === 'IRC1079' ? { id: 'j79', job_number: 'IRC1079' } : { text: 'No job found.', isError: true }),
}))
const saveJobNote = vi.fn(async (_db: unknown, p: Row) => ({ id: 'n1', content: p.note }))
vi.mock('@/lib/communications/notes', () => ({ JobNoteError: class extends Error {}, addJobNote: (db: unknown, p: Row) => saveJobNote(db, p) }))

const { addJobAppointment } = await import('../tools/calendar')
const ctx = () => ({ supabase: fakeSupabase(tables) as never, tenantId: 't1', userId: 'u1' })

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  insert.mockReset()
  saveJobNote.mockClear()
  tables.jobs = [{ id: 'j79', tenant_id: 't1', job_number: 'IRC1079', property_address: '187C Leake Street, Belmont, WA 6104' }]
  tables.automation_config = [{ tenant_id: 't1', key: 'watch_calendar_ids', value: 'kyle@example.com, other@example.com' }]
})

describe('add_job_appointment', () => {
  it('puts the appointment in the calendar with the job number and address, links it, and adds the note', async () => {
    insert.mockResolvedValue({ data: { id: 'g1', etag: 'e1', summary: 'IRC1079 — Site meeting about the tiles', status: 'confirmed', htmlLink: 'https://cal/g1', created: '2026-11-02T03:00:00Z' } })
    const out = await addJobAppointment.run({ job_number: 'IRC1079', title: 'Site meeting about the tiles', start: '2026-11-03T10:00', note: 'Homeowner rang about the tiles; meeting on site tomorrow.' }, ctx())
    expect(out.isError).toBeUndefined()
    expect(out.text).toBe('Put "IRC1079 — Site meeting about the tiles" in the calendar for Tue 3 Nov, 10:00 am at 187C Leake Street, Belmont, WA 6104 and added the note to the job.')
    expect(insert).toHaveBeenCalledWith({ calendarId: 'kyle@example.com', requestBody: expect.objectContaining({
      summary: 'IRC1079 — Site meeting about the tiles', location: '187C Leake Street, Belmont, WA 6104',
      start: { dateTime: '2026-11-03T02:00:00.000Z', timeZone: 'Australia/Perth' }, end: { dateTime: '2026-11-03T03:00:00.000Z', timeZone: 'Australia/Perth' },
    }) })
    expect(tables.calendar_events[0]).toMatchObject({ google_event_id: 'g1', job_id: 'j79', link_source: 'job_number', linked_etag: 'e1' })
    expect(saveJobNote).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ jobId: 'j79', note: 'Homeowner rang about the tiles; meeting on site tomorrow.' }))
  })

  it('asks when it can\'t tell when, and says so when the calendar won\'t take it', async () => {
    expect(await addJobAppointment.run({ job_number: 'IRC1079', title: 'Meet', start: 'tomorrowish' }, ctx())).toMatchObject({ isError: true, text: expect.stringMatching(/^When is it\?/) })
    insert.mockRejectedValue(new Error('403'))
    expect(await addJobAppointment.run({ job_number: 'IRC1079', title: 'Meet', start: '2026-11-03T10:00', note: 'x' }, ctx())).toMatchObject({ isError: true })
    expect(saveJobNote).not.toHaveBeenCalled()
    expect(tables.calendar_events ?? []).toHaveLength(0)
  })
})
