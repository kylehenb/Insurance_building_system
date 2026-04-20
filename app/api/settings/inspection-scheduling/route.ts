import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/get-user'
import type { InspectionSchedulingRules } from '@/lib/scheduling/inspection-rules.types'

// Default values for a new scheduling rules row
const defaultRules: Partial<InspectionSchedulingRules> = {
  zone_day_map: [],
  service_area_postcodes: [],
  cluster_radius_km: 15,
  anchor_job_enabled: true,
  postcode_zone_map: [],
  kpi_override_hours: 8,
  days_since_lodged_escalation: 3,
  insurer_sla_config: [],
  min_cluster_size: 2,
  max_daily_inspections: 6,
  day_end_cutoff: '15:00',
  max_daily_travel_hours: 2.5,
  same_address_always_together: true,
  scheduling_mode: 'quiet',
  quiet_mode_hold_days: 3,
  busy_mode_radius_km: 20,
  cat_event_active: false,
  auto_mode_trigger_count: 8,
  inspector_config: [],
  morning_complex_jobs: true,
  afternoon_simple_jobs: true,
  first_appointment_time: '08:00',
  last_appointment_time: '15:00',
  peak_hour_config: {
    enabled: true,
    morning_peak_start: '07:30',
    morning_peak_end: '09:30',
    afternoon_peak_start: '15:30',
    afternoon_peak_end: '17:30',
    cbd_lat: -31.9505,
    cbd_lng: 115.8605,
    inbound_threshold_pct: 50,
  },
  inspection_buffer_minutes: 30,
  job_type_durations: [
    { job_type: 'BAR', duration_minutes: 45 },
    { job_type: 'BAR_make_safe', duration_minutes: 90 },
    { job_type: 'roof_report', duration_minutes: 60 },
    { job_type: 'make_safe', duration_minutes: 45 },
    { job_type: 'leak_detection', duration_minutes: 60 },
    { job_type: 'specialist', duration_minutes: 60 },
  ],
  capture_availability_from_sms: true,
  access_constraint_block: true,
  vulnerable_person_morning_preference: true,
  vulnerable_person_extra_minutes: 15,
  repeat_reschedule_threshold: 2,
  new_order_hold_minutes: 30,
  cat_cluster_order_count: 5,
  cat_cluster_window_hours: 2,
  same_claim_hold_enabled: true,
  confirmation_threshold_pct: 60,
  overflow_max_per_day: 2,
  overflow_radius_km: 5,
  arrival_window_sms_enabled: true,
  arrival_window_minutes: 120,
}

export async function GET(req: NextRequest) {
  const userSession = await getUser()
  
  if (!userSession || !userSession.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tenantId = userSession.tenant_id
  const supabase = createServiceClient()

  // Try to fetch existing rules
  const { data: existingRules, error: fetchError } = await supabase
    .from('inspection_scheduling_rules' as any)
    .select('*')
    .eq('tenant_id', tenantId as any)
    .single()

  if (fetchError && fetchError.code !== 'PGRST116') {
    // PGRST116 is "not found", which is expected for new tenants
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  // If no rules exist, insert default rules
  if (!existingRules) {
    const { data: newRules, error: insertError } = await supabase
      .from('inspection_scheduling_rules' as any)
      .insert({
        tenant_id: tenantId,
        ...defaultRules,
      } as any)
      .select('*')
      .single()

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json(newRules)
  }

  return NextResponse.json(existingRules)
}

export async function PATCH(req: NextRequest) {
  const userSession = await getUser()
  
  if (!userSession || !userSession.tenant_id || !userSession.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tenantId = userSession.tenant_id
  const userId = userSession.user.id
  
  try {
    const body = await req.json()
    
    // Validate that the body is not empty
    if (!body || Object.keys(body).length === 0) {
      return NextResponse.json({ error: 'Request body is empty' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Update the rules row with explicit tenant_id filter
    const { data: updatedRules, error: updateError } = await supabase
      .from('inspection_scheduling_rules' as any)
      .update({
        ...body,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      } as any)
      .eq('tenant_id', tenantId as any)
      .select('*')
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    if (!updatedRules) {
      return NextResponse.json({ error: 'Rules not found for tenant' }, { status: 404 })
    }

    return NextResponse.json(updatedRules)
  } catch (error) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}
