-- Inspection Scheduling Rules Table
-- Stores configuration for the auto-scheduler rules engine

CREATE TABLE inspection_scheduling_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),

  -- Zone & Geography
  zone_day_map JSONB DEFAULT '[]',
  -- [{zone_name: string, postcodes: string[], preferred_days: string[]}]
  -- preferred_days: ['monday','tuesday','wednesday','thursday','friday']

  service_area_postcodes TEXT[] DEFAULT '{}',
  -- Whitelist of postcodes in service area. Empty = no boundary enforced.

  cluster_radius_km NUMERIC DEFAULT 15,
  -- Only add a job to a day's run if it's within this radius of an existing job

  anchor_job_enabled BOOLEAN DEFAULT true,
  -- One confirmed job opens the zone for that day; others cluster around it

  postcode_zone_map JSONB DEFAULT '[]',
  -- [{postcode: string, zone_name: string}] — flat lookup table, editable in UI

  -- Urgency & Priority
  kpi_override_hours NUMERIC DEFAULT 8,
  -- Jobs within this many hours of breaching their KPI visit deadline jump the queue

  days_since_lodged_escalation INTEGER DEFAULT 3,
  -- Jobs unscheduled for this many days get priority weighting regardless of location

  insurer_sla_config JSONB DEFAULT '[]',
  -- [{client_id: string, insurer_name: string, visit_days: number, priority_boost: boolean}]

  -- Batch & Efficiency
  min_cluster_size INTEGER DEFAULT 2,
  -- Minimum number of jobs in a zone before scheduling a run (unless urgent or overdue)

  max_daily_inspections INTEGER DEFAULT 6,
  -- Hard ceiling per inspector per day

  day_end_cutoff TIME DEFAULT '15:00',
  -- No new inspection starts after this time

  max_daily_travel_hours NUMERIC DEFAULT 2.5,
  -- Total drive time across the run should not exceed this value (hours)

  same_address_always_together BOOLEAN DEFAULT true,
  -- Jobs at the same street address or complex are always scheduled on the same run

  -- Busy vs Quiet Mode
  scheduling_mode TEXT DEFAULT 'quiet',
  -- 'quiet' | 'busy' | 'cat_event' | 'manual'

  quiet_mode_hold_days INTEGER DEFAULT 3,
  -- In quiet mode: hold a job until a cluster forms OR this many days have elapsed

  busy_mode_radius_km NUMERIC DEFAULT 20,
  -- In busy mode: schedule immediately if within this radius of any existing job that day

  cat_event_active BOOLEAN DEFAULT false,
  -- When true: zone-day rules suspended, cluster rules suspended, maximise throughput

  auto_mode_trigger_count INTEGER DEFAULT 8,
  -- If unscheduled job count exceeds this, auto-switch from quiet to busy mode

  -- Inspector Rules
  inspector_config JSONB DEFAULT '[]',
  -- Per-inspector configuration. One object per inspector (user_id).
  -- [{
  --   user_id: string,
  --   name: string,
  --   home_address: string,
  --   home_lat: number,
  --   home_lng: number,
  --   max_drive_radius_km: number,
  --   preferred_zones: string[],          -- zone_names from zone_day_map
  --   availability: {                      -- days and time windows
  --     monday: {available: boolean, start: string, end: string},
  --     tuesday: {available: boolean, start: string, end: string},
  --     wednesday: {available: boolean, start: string, end: string},
  --     thursday: {available: boolean, start: string, end: string},
  --     friday: {available: boolean, start: string, end: string}
  --   },
  --   handles_complex_jobs: boolean        -- if false, only assigned simple BARs
  -- }]

  -- Time of Day Rules
  morning_complex_jobs BOOLEAN DEFAULT true,
  -- Prefer morning slots for complex/combination job types

  afternoon_simple_jobs BOOLEAN DEFAULT true,
  -- Prefer afternoon slots for simple BARs and return visits

  first_appointment_time TIME DEFAULT '08:00',
  -- No inspections before this time

  last_appointment_time TIME DEFAULT '15:00',
  -- No inspections starting after this time (mirrors day_end_cutoff — both must agree)

  peak_hour_config JSONB DEFAULT '{
    "enabled": true,
    "morning_peak_start": "07:30",
    "morning_peak_end": "09:30",
    "afternoon_peak_start": "15:30",
    "afternoon_peak_end": "17:30",
    "cbd_lat": -31.9505,
    "cbd_lng": 115.8605,
    "inbound_threshold_pct": 50
  }',
  -- inbound_threshold_pct: if more than this % of the drive is toward CBD during
  -- morning peak (or away from CBD during afternoon peak), reschedule.
  -- Perth CBD coordinates are the default.

  inspection_buffer_minutes INTEGER DEFAULT 30,
  -- Minimum gap between inspections (travel + notes + overrun buffer)

  job_type_durations JSONB DEFAULT '[
    {"job_type": "BAR", "duration_minutes": 45},
    {"job_type": "BAR_make_safe", "duration_minutes": 90},
    {"job_type": "roof_report", "duration_minutes": 60},
    {"job_type": "make_safe", "duration_minutes": 45},
    {"job_type": "leak_detection", "duration_minutes": 60},
    {"job_type": "specialist", "duration_minutes": 60}
  ]',

  -- Insured Constraints
  capture_availability_from_sms BOOLEAN DEFAULT true,
  -- Parse insured availability preferences from SMS replies and store on inspection record

  access_constraint_block BOOLEAN DEFAULT true,
  -- Jobs with access constraints (key collection, agent required) not auto-scheduled

  vulnerable_person_morning_preference BOOLEAN DEFAULT true,
  -- Vulnerable person flag on job → prefer morning slot + longer block

  vulnerable_person_extra_minutes INTEGER DEFAULT 15,
  -- Additional minutes added to job type duration for vulnerable person jobs

  repeat_reschedule_threshold INTEGER DEFAULT 2,
  -- After this many cancellations, flag for phone call instead of SMS proposal

  -- Hold & Batching
  new_order_hold_minutes INTEGER DEFAULT 30,
  -- Hold window after new order arrives before scheduling (cluster detection)

  cat_cluster_order_count INTEGER DEFAULT 5,
  -- Number of orders from same postcode cluster within cat_cluster_window_hours to trigger CAT mode

  cat_cluster_window_hours INTEGER DEFAULT 2,
  -- Time window for CAT cluster detection

  same_claim_hold_enabled BOOLEAN DEFAULT true,
  -- Hold multi-order same-claim jobs until linked before scheduling

  -- Operational Efficiency
  confirmation_threshold_pct INTEGER DEFAULT 60,
  -- Lock and finalise run only once this % of insureds have confirmed

  overflow_max_per_day INTEGER DEFAULT 2,
  -- Number of overflow inspection slots allowed above max_daily_inspections

  overflow_radius_km NUMERIC DEFAULT 5,
  -- Overflow slots only available for jobs within this radius of a confirmed run job

  arrival_window_sms_enabled BOOLEAN DEFAULT true,
  -- Send morning-of arrival window SMS to insured

  arrival_window_minutes INTEGER DEFAULT 120,
  -- Width of arrival window communicated to insured (e.g. 120 = "between 9am and 11am")

  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(tenant_id)
  -- One config row per tenant
);

-- RLS
ALTER TABLE inspection_scheduling_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON inspection_scheduling_rules
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Index
CREATE INDEX idx_scheduling_rules_tenant ON inspection_scheduling_rules(tenant_id);
