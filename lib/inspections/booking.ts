import type { SupabaseClient } from '@supabase/supabase-js'
import { getCalendarClient } from '@/lib/calendar/client'
import { watchedCalendars } from '@/lib/calendar/sync'
import { listJobNotes } from '@/lib/communications/notes'
import { isFieldAppJob } from '@/lib/jobs/field-app'
import { appBaseUrl } from '@/lib/signing/config'
import { mapsLink } from '@/lib/maps'

// Booking an inspection (tech spec §23.13 "Inspection bookings"). The time is
// agreed with the homeowner outside IRC (a text from the owner's phone);
// once it's agreed, this saves it on the inspection and puts ONE event in the
// owner's calendar that has everything for the day:
//   - title "Inspection — IRC1079 — <address>" (the job number links it to the job),
//   - the address as its place,
//   - a Google Maps directions link (tap → Maps opens with the route, press Start),
//   - the field app link for that inspection,
//   - who to meet, the claim and what's happened (claim description, booking
//     note, the latest job notes).
// Booking again moves the same event rather than adding a second one.

const PERTH_OFFSET_MS = 8 * 60 * 60 * 1000
const DESCRIPTION_CHARS = 600
const NOTE_CHARS = 220
const NOTES_SHOWN = 3

export class InspectionBookingError extends Error {}

export type BookingJob = {
  id: string
  job_number: string
  property_address: string | null
  insured_name: string | null
  insured_phone: string | null
  insurer: string | null
  claim_number: string | null
  loss_type: string | null
  claim_description: string | null
  special_instructions: string | null
}

export type BookingInspection = {
  id: string
  inspection_ref: string | null
  access_notes: string | null
  calendar_event_id: string | null
}

export { mapsLink }

/** The field app page for an inspection (Midcity's jobs open Midcity's field app) */
export function fieldAppLink(inspectionId: string, job: { insurer?: string | null }): string {
  return `${appBaseUrl()}${isFieldAppJob(job) ? '/midcity' : ''}/field/${inspectionId}`
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const oneLine = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const shortDate = (iso: string) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', day: 'numeric', month: 'short' }).format(new Date(iso))

/** The calendar event's title, place and description — the same from the voice tool and the app's Propose button */
export function inspectionEventDetails(params: {
  job: BookingJob
  inspection: BookingInspection | null
  bookingNote?: string
  notes?: { content: string; created_at: string | null }[]
}): { summary: string; location: string | undefined; description: string } {
  const { job, inspection } = params
  const address = oneLine(job.property_address)
  const summary = ['Inspection', job.job_number, address].filter(Boolean).join(' — ')

  const meet = [oneLine(job.insured_name), oneLine(job.insured_phone)].filter(Boolean).join(' · ')
  const claim = [oneLine(job.insurer), job.claim_number ? `claim ${oneLine(job.claim_number)}` : '', oneLine(job.loss_type)].filter(Boolean).join(' · ')
  const access = [oneLine(job.special_instructions), oneLine(inspection?.access_notes)].filter(Boolean).join(' · ')
  const happened = oneLine(job.claim_description)
  const notes = (params.notes ?? [])
    .filter(n => oneLine(n.content))
    .slice(0, NOTES_SHOWN)
    .map(n => `• ${n.created_at ? `${shortDate(n.created_at)}: ` : ''}${clip(oneLine(n.content), NOTE_CHARS)}`)

  const lines: (string | null)[] = [
    meet ? `Meet: ${meet}` : null,
    claim ? `Claim: ${claim}` : null,
    access ? `Access: ${access}` : null,
    params.bookingNote ? `Booking: ${oneLine(params.bookingNote)}` : null,
    '',
    address ? `Directions (Google Maps):\n${mapsLink(address)}` : null,
    '',
    inspection ? `Field app:\n${fieldAppLink(inspection.id, job)}` : 'Field app: no inspection on this job yet — add one in IRC (Inspections tab)',
    '',
    happened ? `What's happened:\n${clip(happened, DESCRIPTION_CHARS)}` : null,
    notes.length ? `\nLatest notes:\n${notes.join('\n')}` : null,
  ]
  const description = lines.filter(l => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { summary, location: address || undefined, description }
}

/** Perth date "2026-11-03" and time "10:00" for an instant */
function perthParts(iso: string): { date: string; time: string } {
  const local = new Date(new Date(iso).getTime() + PERTH_OFFSET_MS).toISOString()
  return { date: local.slice(0, 10), time: local.slice(11, 16) }
}

/** Which calendar an event the office made is on (null: not copied in yet) */
export async function calendarOfEvent(db: SupabaseClient, tenantId: string, eventId: string): Promise<string | null> {
  const { data } = await db.from('calendar_events').select('calendar_id').eq('tenant_id', tenantId).eq('google_event_id', eventId).maybeSingle()
  return (data as { calendar_id: string } | null)?.calendar_id ?? null
}

const JOB_COLUMNS = 'id, job_number, property_address, insured_name, insured_phone, insurer, claim_number, loss_type, claim_description, special_instructions'
const INSPECTION_COLUMNS = 'id, inspection_ref, access_notes, calendar_event_id, form_submitted_at, created_at'

/**
 * The job's inspection to book: the one named by its ref, else the only one
 * not yet submitted. Null when the job has none (the event is still made).
 */
async function inspectionToBook(db: SupabaseClient, tenantId: string, jobId: string, ref?: string, id?: string): Promise<BookingInspection | null> {
  const { data } = await db.from('inspections').select(INSPECTION_COLUMNS).eq('tenant_id', tenantId).eq('job_id', jobId).order('created_at', { ascending: false })
  const all = (data as (BookingInspection & { form_submitted_at: string | null })[] | null) ?? []
  if (id) {
    const hit = all.find(i => i.id === id)
    if (!hit) throw new InspectionBookingError('That inspection isn\'t on this job.')
    return hit
  }
  if (ref) {
    const hit = all.find(i => (i.inspection_ref ?? '').toLowerCase() === ref.toLowerCase())
    if (!hit) throw new InspectionBookingError(`No inspection ${ref} on this job${all.length ? ` — it has ${all.map(i => i.inspection_ref ?? 'one without a ref').join(', ')}` : ''}.`)
    return hit
  }
  const open = all.filter(i => !i.form_submitted_at)
  if (open.length > 1) throw new InspectionBookingError(`This job has ${open.length} open inspections (${open.map(i => i.inspection_ref ?? 'no ref').join(', ')}) — which one?`)
  return open[0] ?? null
}

export type InspectionBooking = {
  job_number: string
  inspection_id: string | null
  inspection_ref: string | null
  start: string
  end: string
  moved: boolean
  event_id: string | null
  event_link: string | null
  maps_link: string | null
  field_app_link: string | null
  address: string | null
}

/**
 * Book (or move) a job's inspection at an agreed time: saves it on the
 * inspection as confirmed and puts it in the owner's calendar (the first
 * watched calendar, §23.13), with directions, the field app and the job's
 * story in the event.
 */
export async function bookInspection(db: SupabaseClient, params: {
  tenantId: string
  jobId: string
  /** ISO instant */
  start: string
  minutes: number
  inspectionRef?: string
  /** Or the inspection itself (moving one on the Calendar page) */
  inspectionId?: string
  /** What was agreed with the homeowner — shown in the event */
  bookingNote?: string
}): Promise<InspectionBooking> {
  const { tenantId, jobId, start, minutes } = params
  const { data: jobRow } = await db.from('jobs').select(JOB_COLUMNS).eq('tenant_id', tenantId).eq('id', jobId).maybeSingle()
  const job = jobRow as BookingJob | null
  if (!job) throw new InspectionBookingError('Job not found.')
  const inspection = await inspectionToBook(db, tenantId, jobId, params.inspectionRef, params.inspectionId)

  const [watched] = await watchedCalendars(db, tenantId)
  if (!watched) throw new InspectionBookingError('No calendar is set up for appointments yet (watch_calendar_ids in the automation settings).')

  const notes = await listJobNotes(db as never, { tenantId, jobId, limit: NOTES_SHOWN }).catch(() => [])
  const details = inspectionEventDetails({ job, inspection, bookingNote: params.bookingNote, notes })
  const end = new Date(new Date(start).getTime() + minutes * 60_000).toISOString()
  const requestBody = {
    ...details,
    start: { dateTime: start, timeZone: 'Australia/Perth' },
    end: { dateTime: end, timeZone: 'Australia/Perth' },
  }

  // Move the inspection's event if it has one, so a rebooking never leaves two
  const calendar = getCalendarClient()
  let event: { id?: string | null; etag?: string | null; status?: string | null; htmlLink?: string | null; created?: string | null } | null = null
  let calendarId = watched
  let moved = false
  if (inspection?.calendar_event_id) {
    const existingCalendar = (await calendarOfEvent(db, tenantId, inspection.calendar_event_id)) ?? watched
    try {
      event = (await calendar.events.patch({ calendarId: existingCalendar, eventId: inspection.calendar_event_id, requestBody: { ...requestBody, status: 'confirmed' } })).data
      calendarId = existingCalendar
      moved = true
    } catch {
      event = null // gone or on a calendar IRC can't change: make a new one
    }
  }
  if (!event) {
    try {
      event = (await calendar.events.insert({ calendarId: watched, requestBody })).data
    } catch (err) {
      console.error('[inspections] booking the calendar event failed:', err)
      throw new InspectionBookingError('The calendar didn\'t take the booking — nothing was changed. Check IRC can still reach the calendar.')
    }
  }

  const { date, time } = perthParts(start)
  if (inspection) {
    const { error } = await db.from('inspections').update({
      status: 'appointment_confirmed',
      scheduled_date: date,
      start_time: time,
      finish_time: perthParts(end).time,
      duration_minutes: minutes,
      booking_confirmed_at: new Date().toISOString(),
      insured_notified: true,
      calendar_event_id: event.id ?? null,
    }).eq('tenant_id', tenantId).eq('id', inspection.id)
    if (error) throw error
  }

  if (event.id) {
    await db.from('calendar_events').upsert({
      tenant_id: tenantId, calendar_id: calendarId, google_event_id: event.id,
      summary: details.summary, description: details.description, location: details.location ?? null,
      start_at: start, end_at: end, status: event.status ?? 'confirmed', html_link: event.htmlLink ?? null,
      etag: event.etag ?? null, google_created_at: event.created ?? new Date().toISOString(),
      job_id: jobId, link_source: inspection ? 'inspection' : 'job_number', link_reason: 'Inspection booked in IRC', linked_etag: event.etag ?? null,
    }, { onConflict: 'tenant_id,calendar_id,google_event_id' })
  }

  return {
    job_number: job.job_number,
    inspection_id: inspection?.id ?? null,
    inspection_ref: inspection?.inspection_ref ?? null,
    start, end, moved,
    event_id: event.id ?? null,
    event_link: event.htmlLink ?? null,
    maps_link: details.location ? mapsLink(details.location) : null,
    field_app_link: inspection ? fieldAppLink(inspection.id, job) : null,
    address: details.location ?? null,
  }
}
