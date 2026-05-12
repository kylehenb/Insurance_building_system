import { createServiceClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

// Check for appointments that have passed but not started
// This can be called manually or set up as a simple daily check
export async function POST() {
  const supabase = createServiceClient()

  try {
    // Find inspections where:
    // 1. Status is 'appointment_confirmed' - NOT 'inspection_started'
    // 2. Scheduled date + finish time has passed by > 4 hours
    // 3. Safety has not been confirmed (inspection hasn't started)
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()

    const { data: missedAppointments, error } = await supabase
      .from('inspections')
      .select('id, scheduled_date, finish_time, status, safety_confirmed_at')
      .eq('status', 'appointment_confirmed')
      .is('safety_confirmed_at', null)
      .lt('scheduled_date', fourHoursAgo)
      .or(`finish_time.lt.${fourHoursAgo.split('T')[1]}`)

    if (error) {
      console.error('Error checking missed appointments:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    // Update each missed appointment
    if (missedAppointments && missedAppointments.length > 0) {
      const { error: updateError } = await supabase
        .from('inspections')
        .update({ status: 'appointment_passed_not_started' })
        .in('id', missedAppointments.map(a => a.id))

      if (updateError) {
        console.error('Error updating missed appointments:', updateError)
        return NextResponse.json({ error: 'Update error' }, { status: 500 })
      }

      console.log(`Updated ${missedAppointments.length} missed appointments`)
    }

    return NextResponse.json({ 
      updated: missedAppointments?.length || 0,
      message: 'Check completed' 
    })

  } catch (err) {
    console.error('Unexpected error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
