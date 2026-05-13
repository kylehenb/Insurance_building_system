import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getCalendarClient, CALENDAR_ID } from '@/lib/calendar/client'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await params

    const authClient = await createClient()
    const { data: { user }, error: authError } = await authClient.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createServiceClient()

    const { data: userRow } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Fetch current calendar_event_id so we can delete it
    const { data: inspection } = await supabase
      .from('inspections')
      .select('calendar_event_id')
      .eq('id', inspectionId)
      .eq('tenant_id', userRow.tenant_id)
      .single()

    // Delete the calendar event if it exists
    if (inspection?.calendar_event_id) {
      try {
        const calendar = getCalendarClient()
        await calendar.events.delete({
          calendarId: CALENDAR_ID,
          eventId: inspection.calendar_event_id,
        })
      } catch (calErr) {
        console.error('[reschedule] calendar delete error:', calErr)
      }
    }

    const { error } = await supabase
      .from('inspections')
      .update({
        status: 'reschedule_required',
        calendar_event_id: null,
        booking_confirmed_at: null,
        scheduling_sms_sent_at: null,
      })
      .eq('id', inspectionId)
      .eq('tenant_id', userRow.tenant_id)

    if (error) {
      console.error('[reschedule] update error:', error)
      return NextResponse.json({ error: 'Failed to mark for reschedule' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[reschedule] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
