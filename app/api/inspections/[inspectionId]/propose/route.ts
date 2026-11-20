import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getCalendarClient, CALENDAR_ID } from '@/lib/calendar/client'
import { inspectionEventDetails, type BookingJob } from '@/lib/inspections/booking'
import { listJobNotes } from '@/lib/communications/notes'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await params

    const authClient = await createClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { scheduledDate, startTime, finishTime } = await req.json()

    const supabase = createServiceClient()

    const { data: userRow } = await supabase
      .from('users')
      .select('tenant_id, name')
      .eq('id', user.id)
      .single()

    if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const { data: inspection, error: inspError } = await supabase
      .from('inspections')
      .select(`
        id, inspection_ref, status, scheduled_date, start_time, finish_time, duration_minutes,
        job_id, inspector_id, access_notes, calendar_event_id,
        jobs!job_id (
          id, job_number, property_address, insured_name, insured_phone,
          insurer, loss_type, claim_number, claim_description, special_instructions
        ),
        users!inspector_id (name)
      `)
      .eq('id', inspectionId)
      .eq('tenant_id', userRow.tenant_id)
      .single()

    if (inspError || !inspection) {
      return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
    }

    const date = scheduledDate ?? inspection.scheduled_date
    const start = startTime ?? inspection.start_time
    const finish = finishTime ?? inspection.finish_time

    if (!date || !start || !finish) {
      return NextResponse.json(
        { error: 'Scheduled date, start time, and finish time are required' },
        { status: 400 }
      )
    }

    const job = (inspection as unknown as { jobs: BookingJob }).jobs

    // The same event as a booking by voice (lib/inspections/booking.ts):
    // directions, the field app link, who to meet and what's happened
    const notes = await listJobNotes(supabase, { tenantId: userRow.tenant_id, jobId: inspection.job_id, limit: 3 }).catch(() => [])
    const details = inspectionEventDetails({ job, inspection, notes })

    // Ensure HH:MM times get :00 seconds appended — Google Calendar requires full RFC3339
    const toFullTime = (t: string) => t.length === 5 ? `${t}:00` : t

    // Get the UTC offset for Australia/Perth on the scheduled date (handles DST correctly)
    function getPerthOffset(dateStr: string): string {
      const refDate = new Date(`${dateStr}T12:00:00Z`)
      const parts = new Intl.DateTimeFormat('en-AU', {
        timeZone: 'Australia/Perth',
        timeZoneName: 'longOffset',
      }).formatToParts(refDate)
      const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT+10:00'
      const match = offsetPart.match(/GMT([+-]\d+:\d+)/)
      return match ? match[1] : '+10:00'
    }

    const tzOffset = getPerthOffset(date)
    const startDateTime = `${date}T${toFullTime(start)}${tzOffset}`
    const endDateTime = `${date}T${toFullTime(finish)}${tzOffset}`

    // Calculate alarm minutes so it fires at 7:00 AM on the day of the inspection
    const [startH, startM] = toFullTime(start).split(':').map(Number)
    const alarmMinutesBefore = startH * 60 + startM - 7 * 60

    // Create Google Calendar event
    let calendarEventId: string | null = null
    try {
      const calendar = getCalendarClient()
      const event = await calendar.events.insert({
        calendarId: CALENDAR_ID,
        requestBody: {
          ...details,
          start: {
            dateTime: startDateTime,
            timeZone: 'Australia/Perth',
          },
          end: {
            dateTime: endDateTime,
            timeZone: 'Australia/Perth',
          },
          reminders: {
            useDefault: false,
            overrides: alarmMinutesBefore > 0 ? [{ method: 'popup', minutes: alarmMinutesBefore }] : [],
          },
        },
      })
      calendarEventId = event.data.id ?? null
    } catch (calErr) {
      console.error('[propose] Google Calendar error:', calErr)
      // Don't block the whole flow — calendar creation is best-effort
    }

    // Mock SMS to site contact
    console.log(`[propose] MOCK SMS to ${job?.insured_phone ?? 'unknown'}: Appointment proposed for ${date} at ${start}`)

    // Update inspection
    const { error: updateError } = await supabase
      .from('inspections')
      .update({
        status: 'appointment_proposed',
        scheduled_date: date,
        start_time: start,
        finish_time: finish,
        scheduling_sms_sent_at: new Date().toISOString(),
        ...(calendarEventId ? { calendar_event_id: calendarEventId } : {}),
      })
      .eq('id', inspectionId)
      .eq('tenant_id', userRow.tenant_id)

    if (updateError) {
      console.error('[propose] update error:', updateError)
      return NextResponse.json({ error: 'Failed to update inspection' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      calendarEventId,
      calendarCreated: !!calendarEventId,
    })
  } catch (err) {
    console.error('[propose] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
