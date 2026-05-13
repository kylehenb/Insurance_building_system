import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getCalendarClient, CALENDAR_ID } from '@/lib/calendar/client'

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
        job_id, inspector_id,
        jobs!job_id (
          id, job_number, property_address, insured_name, insured_phone,
          insurer, loss_type, claim_number
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

    const job = (inspection as any).jobs
    const inspector = (inspection as any).users

    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.insurancerepairco.com.au'
    const fieldAppUrl = `${appBaseUrl}/field/${inspectionId}`

    // Build calendar event description
    const descriptionLines = [
      `Inspection Ref: ${inspection.inspection_ref ?? inspectionId}`,
      `Job: ${job?.job_number ?? '-'}`,
      `Insured: ${job?.insured_name ?? '-'}`,
      job?.insured_phone ? `Contact: ${job.insured_phone}` : null,
      `Insurer: ${job?.insurer ?? '-'}`,
      `Loss Type: ${job?.loss_type ?? '-'}`,
      job?.claim_number ? `Claim #: ${job.claim_number}` : null,
      `Inspector: ${inspector?.name ?? userRow.name}`,
      '',
      `Field App: ${fieldAppUrl}`,
    ].filter(Boolean).join('\n')

    const startDateTime = `${date}T${start}`
    const endDateTime = `${date}T${finish}`

    const title = [
      'Inspection',
      inspection.inspection_ref,
      job?.property_address,
    ].filter(Boolean).join(' – ')

    // Create Google Calendar event
    let calendarEventId: string | null = null
    try {
      const calendar = getCalendarClient()
      const event = await calendar.events.insert({
        calendarId: CALENDAR_ID,
        requestBody: {
          summary: title,
          description: descriptionLines,
          location: job?.property_address ?? undefined,
          start: {
            dateTime: startDateTime,
            timeZone: 'Australia/Sydney',
          },
          end: {
            dateTime: endDateTime,
            timeZone: 'Australia/Sydney',
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
