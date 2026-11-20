import type { SupabaseClient } from '@supabase/supabase-js'
import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { getCalendarClient } from '@/lib/calendar/client'
import { spokenEventTime, watchedCalendars } from '@/lib/calendar/sync'
import { JobNoteError, addJobNote as saveJobNote } from '@/lib/communications/notes'
import { InspectionBookingError, bookInspection as bookInspectionFor } from '@/lib/inspections/booking'
import { parseSendAt } from '@/lib/mail/schedule-rules'
import { isToolResult, jobFromArgs } from '@/lib/mcp/tools/excess'

// Appointments by voice and chat (tech spec §23.13): "I'm meeting the
// homeowner on site tomorrow at 10 — write a job note and put it in my
// calendar". The event goes on the office's calendar with the job number in
// its title and the job's address as its place, so it's linked to the job
// for certain — and after it, the check-in asks what happened.

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const db = (ctx: McpContext) => ctx.supabase as unknown as SupabaseClient
const DEFAULT_MINUTES = 60
const MAX_MINUTES = 12 * 60

export const addJobAppointment: McpTool = {
  name: 'add_job_appointment',
  title: 'Add job appointment',
  description: [
    'Puts an appointment for a job in the calendar — "I\'m meeting the homeowner at IRC1079 tomorrow at 10, put it in my calendar". The event\'s title starts with the job number and its place is the job\'s address, so IRC knows which job it\'s for (and checks in afterwards on what happened).',
    'start is Perth time "2026-11-03T10:00". note, if given, is also added to the job\'s notes (one call does both).',
    'Not for inspections: when an inspection has been booked or moved, use book_inspection, which also puts the directions and field app links in the event.',
    'Read back the job, day, time and title, and get a yes first.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      job_number: { type: 'string', description: 'The job, e.g. IRC1079.' },
      title: { type: 'string', description: 'What it is, e.g. "Site meeting with the homeowner about the tiles".' },
      start: { type: 'string', description: 'Perth date and time, "2026-11-03T10:00".' },
      duration_minutes: { type: 'number', description: 'How long, in minutes. Default 60.' },
      note: { type: 'string', description: 'A job note to add as well, in the user\'s words (e.g. what the call was about).' },
    },
    required: ['job_number', 'title', 'start'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  permission: 'jobs.notes',

  async run(args, ctx): Promise<McpToolResult> {
    const title = str(args.title)
    if (!title) return { text: 'What\'s the appointment for?', isError: true }
    const start = parseSendAt(str(args.start))
    if (!start) return { text: 'When is it? Give a Perth date and time like "2026-11-03T10:00".', isError: true }
    const minutes = Math.min(MAX_MINUTES, Math.max(5, Math.round(Number(args.duration_minutes) || DEFAULT_MINUTES)))
    const found = await jobFromArgs(args, ctx)
    if (isToolResult(found)) return found
    const [calendarId] = await watchedCalendars(db(ctx), ctx.tenantId)
    if (!calendarId) return { text: 'No calendar is set up for appointments yet (watch_calendar_ids in the automation settings).', isError: true }
    const { data: job } = await db(ctx).from('jobs').select('property_address').eq('tenant_id', ctx.tenantId).eq('id', found.id).maybeSingle()
    const address = (job as { property_address: string | null } | null)?.property_address ?? undefined
    const note = str(args.note)
    const end = new Date(new Date(start).getTime() + minutes * 60_000).toISOString()

    let event
    try {
      event = (await getCalendarClient().events.insert({
        calendarId,
        requestBody: {
          summary: `${found.job_number} — ${title}`,
          location: address,
          description: note || undefined,
          start: { dateTime: start, timeZone: 'Australia/Perth' },
          end: { dateTime: end, timeZone: 'Australia/Perth' },
        },
      })).data
    } catch (err) {
      console.error('[calendar] adding the appointment failed:', err)
      return { text: 'The calendar didn\'t take the appointment — nothing was added. Check IRC can still reach the calendar.', isError: true }
    }
    if (event.id) {
      await db(ctx).from('calendar_events').insert({
        tenant_id: ctx.tenantId, calendar_id: calendarId, google_event_id: event.id,
        summary: event.summary ?? null, description: event.description ?? null, location: event.location ?? null,
        start_at: start, end_at: end, status: event.status ?? 'confirmed', html_link: event.htmlLink ?? null,
        etag: event.etag ?? null, google_created_at: event.created ?? new Date().toISOString(),
        job_id: found.id, link_source: 'job_number', link_reason: 'Added for the job by voice or chat', linked_etag: event.etag ?? null,
      })
    }

    let noted = ''
    if (note) {
      try {
        await saveJobNote(ctx.supabase, { tenantId: ctx.tenantId, userId: ctx.userId, jobId: found.id, note, source: ctx.via === 'chat' ? 'assistant' : 'voice' })
        noted = ' and added the note to the job'
      } catch (err) {
        noted = err instanceof JobNoteError ? `, but the note wasn't added: ${err.message}` : ', but the note wasn\'t added'
      }
    }
    return {
      text: `Put "${found.job_number} — ${title}" in the calendar for ${spokenEventTime(start)}${address ? ` at ${address}` : ''}${noted}.`,
      data: { job_number: found.job_number, event_id: event.id ?? null, start, end, link: event.htmlLink ?? null },
    }
  },
}

export const bookInspection: McpTool = {
  name: 'book_inspection',
  title: 'Book inspection',
  description: [
    'Books a job\'s inspection at the time agreed with the homeowner, or moves it — "inspection for IRC1079 is booked Thursday 8am", "move the Belmont inspection to Friday at 9". Use this, not add_job_appointment or a calendar tool, for any inspection or inspection site visit.',
    'It marks the inspection confirmed in IRC and puts one event in the calendar titled "Inspection — IRC1079 — <address>", with the address as its place, a Google Maps directions link, the field app link, who to meet and what\'s happened on the job. Booking a job again moves its existing event rather than adding another.',
    'start is Perth time "2026-11-03T08:00". note is anything agreed with the homeowner (e.g. "side gate, dog in the yard") — it goes in the event and on the job\'s notes.',
    'Read back the job, address, day and time, and get a yes first.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      job_number: { type: 'string', description: 'The job, e.g. IRC1079.' },
      start: { type: 'string', description: 'Perth date and time, "2026-11-03T08:00".' },
      duration_minutes: { type: 'number', description: 'How long, in minutes. Default 60.' },
      note: { type: 'string', description: 'What was agreed with the homeowner, in the user\'s words.' },
      inspection_ref: { type: 'string', description: 'Only when the job has more than one open inspection: which one.' },
    },
    required: ['job_number', 'start'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  permission: 'jobs.edit',

  async run(args, ctx): Promise<McpToolResult> {
    const start = parseSendAt(str(args.start))
    if (!start) return { text: 'When is it? Give a Perth date and time like "2026-11-03T08:00".', isError: true }
    const minutes = Math.min(MAX_MINUTES, Math.max(5, Math.round(Number(args.duration_minutes) || DEFAULT_MINUTES)))
    const found = await jobFromArgs(args, ctx)
    if (isToolResult(found)) return found
    const note = str(args.note)

    let booking
    try {
      booking = await bookInspectionFor(db(ctx), { tenantId: ctx.tenantId, jobId: found.id, start, minutes, inspectionRef: str(args.inspection_ref) || undefined, bookingNote: note || undefined })
    } catch (err) {
      if (err instanceof InspectionBookingError) return { text: err.message, isError: true }
      throw err
    }

    let noted = ''
    if (note) {
      try {
        await saveJobNote(ctx.supabase, { tenantId: ctx.tenantId, userId: ctx.userId, jobId: found.id, note: `Inspection booked for ${spokenEventTime(start)}. ${note}`, source: ctx.via === 'chat' ? 'assistant' : 'voice' })
        noted = ' The note is on the job too.'
      } catch (err) {
        noted = err instanceof JobNoteError ? ` The note wasn't added: ${err.message}` : ' The note wasn\'t added.'
      }
    }
    const where = booking.address ? ` at ${booking.address}` : ''
    const what = booking.moved ? 'Moved the inspection' : 'Booked the inspection'
    const links = booking.field_app_link
      ? 'The calendar event has the directions and field app links.'
      : 'The calendar event has the directions link, but the job has no inspection in IRC yet, so there\'s no field app link — add one on the job\'s Inspections tab and book it again.'
    return {
      text: `${what} for ${booking.job_number} on ${spokenEventTime(start)}${where}. ${links}${noted}`,
      data: booking,
    }
  },
}
