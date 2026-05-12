import { createServiceClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

// Daily cleanup for missed appointments
// Call this once daily (or manually) to catch any missed appointments
export async function POST() {
  const supabase = createServiceClient()

  try {
    console.log('Starting daily inspection cleanup...')

    // Check for missed appointments (same logic as real-time check)
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()

    const { data: missedAppointments, error } = await supabase
      .from('inspections')
      .select('id, inspection_ref, scheduled_date, finish_time, status, safety_confirmed_at')
      .eq('status', 'confirmed')
      .is('safety_confirmed_at', null)
      .lt('scheduled_date', fourHoursAgo)

    if (error) {
      console.error('Error finding missed appointments:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    // Filter by finish time as well
    const trulyMissed = missedAppointments?.filter(inspection => {
      if (!inspection.finish_time) return false
      const finishDateTime = new Date(`${inspection.scheduled_date}T${inspection.finish_time}`)
      return finishDateTime < new Date(fourHoursAgo)
    }) || []

    // Update missed appointments
    if (trulyMissed.length > 0) {
      const { error: updateError } = await supabase
        .from('inspections')
        .update({ status: 'appointment_passed_not_started' })
        .in('id', trulyMissed.map(a => a.id))

      if (updateError) {
        console.error('Error updating missed appointments:', updateError)
        return NextResponse.json({ error: 'Update error' }, { status: 500 })
      }

      console.log(`Daily cleanup: Updated ${trulyMissed.length} missed appointments`)
      console.log('Missed appointments:', trulyMissed.map(a => a.inspection_ref))
    }

    return NextResponse.json({ 
      updated: trulyMissed.length,
      message: `Daily cleanup completed. Updated ${trulyMissed.length} missed appointments.`,
      missed: trulyMissed.map(a => ({ id: a.id, ref: a.inspection_ref, date: a.scheduled_date }))
    })

  } catch (err) {
    console.error('Daily cleanup error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// Also support GET for manual browser testing
export async function GET() {
  return POST()
}
