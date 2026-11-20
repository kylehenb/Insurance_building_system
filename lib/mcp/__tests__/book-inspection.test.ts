import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type Row } from './fake-supabase'

// book_inspection: the homeowner agreed a time by text, so "the IRC1079
// inspection is booked Thursday 8am" confirms the inspection and puts one
// event in the owner's calendar with directions, the field app and the story.

const tables: Record<string, Row[]> = {}
const insert = vi.fn()
const patch = vi.fn()
vi.mock('@/lib/calendar/client', () => ({ getCalendarClient: () => ({ events: { insert, patch } }) }))
vi.mock('@/lib/mcp/tools/excess', () => ({
  isToolResult: (v: unknown) => !!v && typeof v === 'object' && 'text' in v,
  jobFromArgs: async (args: Row) => (args.job_number === 'IRC1079' ? { id: 'j79', job_number: 'IRC1079' } : { text: 'No job found.', isError: true }),
}))
const saveJobNote = vi.fn(async (_db: unknown, p: Row) => ({ id: 'n1', content: p.note }))
vi.mock('@/lib/communications/notes', () => ({
  JobNoteError: class extends Error {},
  addJobNote: (db: unknown, p: Row) => saveJobNote(db, p),
  listJobNotes: async () => [{ content: 'Homeowner rang, water still coming through after rain.', created_at: '2026-11-17T02:00:00Z' }],
}))

process.env.NEXT_PUBLIC_APP_URL = 'https://irc.test'
const { bookInspection } = await import('../tools/calendar')
const { inspectionEventDetails, mapsLink } = await import('@/lib/inspections/booking')
const ctx = () => ({ supabase: fakeSupabase(tables) as never, tenantId: 't1', userId: 'u1' })

const JOB = {
  id: 'j79', tenant_id: 't1', job_number: 'IRC1079', property_address: '187C Leake Street, Belmont, WA 6104',
  insured_name: 'Jane Smith', insured_phone: '0412 345 678', insurer: 'Suncorp', claim_number: 'CL123', loss_type: 'Storm',
  claim_description: 'Storm damage to the roof, water through the bedroom ceiling.', special_instructions: null,
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  insert.mockReset(); patch.mockReset(); saveJobNote.mockClear()
  tables.jobs = [{ ...JOB }]
  tables.inspections = [{ id: 'i1', tenant_id: 't1', job_id: 'j79', inspection_ref: 'BAR-IRC1079-1', access_notes: 'Side gate', calendar_event_id: null, form_submitted_at: null, created_at: '2026-11-01T00:00:00Z', status: 'unscheduled' }]
  tables.automation_config = [{ tenant_id: 't1', key: 'watch_calendar_ids', value: 'kyle@example.com' }]
})

describe('inspectionEventDetails', () => {
  it('has the job and address in the title, and directions, the field app and the story in the description', () => {
    const d = inspectionEventDetails({
      job: JOB, inspection: { id: 'i1', inspection_ref: 'BAR-IRC1079-1', access_notes: 'Side gate', calendar_event_id: null },
      bookingNote: 'Dog in the yard', notes: [{ content: 'Homeowner rang.', created_at: '2026-11-17T02:00:00Z' }],
    })
    expect(d.summary).toBe('Inspection — IRC1079 — 187C Leake Street, Belmont, WA 6104')
    expect(d.location).toBe('187C Leake Street, Belmont, WA 6104')
    expect(d.description).toContain('Meet: Jane Smith · 0412 345 678')
    expect(d.description).toContain('Access: Side gate')
    expect(d.description).toContain('Booking: Dog in the yard')
    expect(d.description).toContain('https://www.google.com/maps/dir/?api=1&destination=187C%20Leake%20Street%2C%20Belmont%2C%20WA%206104')
    expect(d.description).toContain('Field app:\nhttps://irc.test/field/i1')
    expect(d.description).toContain("What's happened:\nStorm damage to the roof")
    expect(d.description).toContain('• 17 Nov: Homeowner rang.')
  })

  it('opens Midcity\'s field app for a Midcity job', () => {
    const d = inspectionEventDetails({ job: { ...JOB, insurer: 'Midcity' }, inspection: { id: 'i9', inspection_ref: null, access_notes: null, calendar_event_id: null } })
    expect(d.description).toContain('https://irc.test/midcity/field/i9')
  })

  it('maps link encodes the address', () => {
    expect(mapsLink('1 A & B St')).toBe('https://www.google.com/maps/dir/?api=1&destination=1%20A%20%26%20B%20St')
  })
})

describe('book_inspection', () => {
  it('confirms the inspection, puts it in the calendar with the links, links the event and notes the job', async () => {
    insert.mockResolvedValue({ data: { id: 'g1', etag: 'e1', status: 'confirmed', htmlLink: 'https://cal/g1', created: '2026-11-19T03:00:00Z' } })
    const out = await bookInspection.run({ job_number: 'IRC1079', start: '2026-11-20T08:00', note: 'Dog in the yard' }, ctx())
    expect(out.isError).toBeUndefined()
    expect(out.text).toMatch(/^Booked the inspection for IRC1079 on .*8:00 am at 187C Leake Street, Belmont, WA 6104\. The calendar event has the directions and field app links\. The note is on the job too\.$/)
    const body = insert.mock.calls[0][0]
    expect(body.calendarId).toBe('kyle@example.com')
    expect(body.requestBody).toMatchObject({
      summary: 'Inspection — IRC1079 — 187C Leake Street, Belmont, WA 6104',
      start: { dateTime: '2026-11-20T00:00:00.000Z', timeZone: 'Australia/Perth' },
      end: { dateTime: '2026-11-20T01:00:00.000Z', timeZone: 'Australia/Perth' },
    })
    expect(body.requestBody.description).toContain('https://irc.test/field/i1')
    expect(tables.inspections[0]).toMatchObject({ status: 'appointment_confirmed', scheduled_date: '2026-11-20', start_time: '08:00', finish_time: '09:00', calendar_event_id: 'g1', insured_notified: true })
    expect(tables.calendar_events[0]).toMatchObject({ google_event_id: 'g1', job_id: 'j79', link_source: 'inspection', calendar_id: 'kyle@example.com' })
    expect(saveJobNote).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ jobId: 'j79', note: expect.stringContaining('Dog in the yard') }))
    expect(out.data).toMatchObject({ field_app_link: 'https://irc.test/field/i1', moved: false })
  })

  it('moves the existing event when booked again, rather than adding a second', async () => {
    tables.inspections[0].calendar_event_id = 'g1'
    tables.calendar_events = [{ tenant_id: 't1', calendar_id: 'kyle@example.com', google_event_id: 'g1', job_id: 'j79' }]
    patch.mockResolvedValue({ data: { id: 'g1', etag: 'e2', status: 'confirmed' } })
    const out = await bookInspection.run({ job_number: 'IRC1079', start: '2026-11-21T09:00' }, ctx())
    expect(out.text).toMatch(/^Moved the inspection/)
    expect(patch).toHaveBeenCalledWith(expect.objectContaining({ calendarId: 'kyle@example.com', eventId: 'g1' }))
    expect(insert).not.toHaveBeenCalled()
    expect(tables.calendar_events).toHaveLength(1)
    expect(tables.inspections[0]).toMatchObject({ scheduled_date: '2026-11-21', start_time: '09:00' })
  })

  it('still books the event for a job with no inspection, and says there\'s no field app link', async () => {
    tables.inspections = []
    insert.mockResolvedValue({ data: { id: 'g2' } })
    const out = await bookInspection.run({ job_number: 'IRC1079', start: '2026-11-20T08:00' }, ctx())
    expect(out.text).toContain('no field app link')
    expect(insert.mock.calls[0][0].requestBody.description).toContain('no inspection on this job yet')
  })

  it('asks which when there are two open inspections, and changes nothing when the calendar fails', async () => {
    tables.inspections.push({ ...tables.inspections[0], id: 'i2', inspection_ref: 'ROOF-IRC1079-2' })
    expect(await bookInspection.run({ job_number: 'IRC1079', start: '2026-11-20T08:00' }, ctx())).toMatchObject({ isError: true, text: expect.stringContaining('which one?') })
    tables.inspections.pop()
    insert.mockRejectedValue(new Error('403'))
    expect(await bookInspection.run({ job_number: 'IRC1079', start: '2026-11-20T08:00', note: 'x' }, ctx())).toMatchObject({ isError: true })
    expect(tables.inspections[0].status).toBe('unscheduled')
    expect(saveJobNote).not.toHaveBeenCalled()
  })
})
