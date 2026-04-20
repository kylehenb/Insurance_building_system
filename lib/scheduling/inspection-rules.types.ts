export interface ZoneDayMapping {
  zone_name: string
  postcodes: string[]
  preferred_days: ('monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday')[]
}

export interface PostcodeZoneEntry {
  postcode: string
  zone_name: string
}

export interface InsurerSLAConfig {
  client_id: string
  insurer_name: string
  visit_days: number
  priority_boost: boolean
}

export type AvailabilityDay = {
  available: boolean
  start: string  // HH:MM
  end: string    // HH:MM
}

export interface InspectorConfig {
  user_id: string
  name: string
  home_address: string
  home_lat: number
  home_lng: number
  max_drive_radius_km: number
  preferred_zones: string[]
  availability: {
    monday: AvailabilityDay
    tuesday: AvailabilityDay
    wednesday: AvailabilityDay
    thursday: AvailabilityDay
    friday: AvailabilityDay
  }
  handles_complex_jobs: boolean
}

export interface PeakHourConfig {
  enabled: boolean
  morning_peak_start: string   // HH:MM
  morning_peak_end: string     // HH:MM
  afternoon_peak_start: string // HH:MM
  afternoon_peak_end: string   // HH:MM
  cbd_lat: number
  cbd_lng: number
  inbound_threshold_pct: number
}

export interface JobTypeDuration {
  job_type: string
  duration_minutes: number
}

export type SchedulingMode = 'quiet' | 'busy' | 'cat_event' | 'manual'

export interface InspectionSchedulingRules {
  id: string
  tenant_id: string

  // Zone & Geography
  zone_day_map: ZoneDayMapping[]
  service_area_postcodes: string[]
  cluster_radius_km: number
  anchor_job_enabled: boolean
  postcode_zone_map: PostcodeZoneEntry[]

  // Urgency & Priority
  kpi_override_hours: number
  days_since_lodged_escalation: number
  insurer_sla_config: InsurerSLAConfig[]

  // Batch & Efficiency
  min_cluster_size: number
  max_daily_inspections: number
  day_end_cutoff: string        // HH:MM
  max_daily_travel_hours: number
  same_address_always_together: boolean

  // Busy vs Quiet Mode
  scheduling_mode: SchedulingMode
  quiet_mode_hold_days: number
  busy_mode_radius_km: number
  cat_event_active: boolean
  auto_mode_trigger_count: number

  // Inspector Rules
  inspector_config: InspectorConfig[]

  // Time of Day
  morning_complex_jobs: boolean
  afternoon_simple_jobs: boolean
  first_appointment_time: string  // HH:MM
  last_appointment_time: string   // HH:MM
  peak_hour_config: PeakHourConfig
  inspection_buffer_minutes: number
  job_type_durations: JobTypeDuration[]

  // Insured Constraints
  capture_availability_from_sms: boolean
  access_constraint_block: boolean
  vulnerable_person_morning_preference: boolean
  vulnerable_person_extra_minutes: number
  repeat_reschedule_threshold: number

  // Hold & Batching
  new_order_hold_minutes: number
  cat_cluster_order_count: number
  cat_cluster_window_hours: number
  same_claim_hold_enabled: boolean

  // Operational Efficiency
  confirmation_threshold_pct: number
  overflow_max_per_day: number
  overflow_radius_km: number
  arrival_window_sms_enabled: boolean
  arrival_window_minutes: number

  updated_by: string | null
  updated_at: string
  created_at: string
}

// Input type for a job being evaluated against the rules
export interface SchedulingCandidate {
  job_id: string
  job_number: string
  property_address: string
  lat: number
  lng: number
  postcode: string
  wo_type: string              // 'BAR' | 'make_safe' | 'roof_report' | 'BAR_make_safe' etc.
  is_make_safe: boolean
  insurer: string
  client_id: string
  days_since_lodged: number
  kpi_visit_due: string | null // ISO timestamp
  has_access_constraint: boolean
  vulnerable_person: boolean
  insured_availability_notes: string | null
  cancellation_count: number
  claim_number: string
  sum_insured: number | null
}

// Output of rule evaluation — one per candidate
export interface RuleEvaluationResult {
  job_id: string
  eligible: boolean            // false = do not schedule at this time
  disqualifiers: string[]      // human-readable reasons why not eligible
  priority_score: number       // higher = schedule sooner (used to rank candidates)
  priority_flags: string[]     // human-readable reasons for priority boost
  suggested_time_preference: 'morning' | 'afternoon' | 'any'
  estimated_duration_minutes: number
  requires_senior_inspector: boolean
  peak_hour_risk: boolean      // true = needs routing check before confirming time slot
  overflow_eligible: boolean   // true = can fill an overflow slot if run is full
  notes: string[]              // other notes for the human reviewer
}
