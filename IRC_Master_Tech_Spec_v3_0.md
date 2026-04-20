# IRC Master — Full Technical Specification
## For Windsurf / Cursor AI-Assisted Build

---

## 1. Project Overview

IRC Master is a job management platform for insurance repair businesses. It manages the full workflow from insurer order intake through inspections, reports, scoping, quoting, photo management, communications, and trade coordination.

**Dual purpose:**
- Production tool for Insurance Repair Co (IRC) — Kyle Bindon, Perth WA
- Future SaaS product licensed to other insurance repair operators

**Current state being migrated from:** Google Apps Script + Google Sheets + Google Drive

**Team (current):** Kyle Bindon (owner/assessor), plus two others (inspection and admin roles).

---

## 2. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend framework | Next.js (App Router) | TypeScript throughout |
| Styling | Tailwind CSS | Black and beige brand palette |
| UI components | shadcn/ui | |
| Backend / Database | Supabase (Postgres) | Managed, single project |
| Auth | Supabase Auth — Magic Link | Persistent sessions |
| File storage | Supabase Storage | Photos, PDFs, documents |
| PDF generation | Puppeteer on Railway | Separate small service ~$5-7/month |
| Hosting | Cloudflare Pages (frontend) | Free tier |
| AI features | Anthropic Claude API | claude-sonnet-4-20250514 |
| Vision/parsing | Google Gemini Flash 2.0 | Cost-efficient parsing tasks |
| SMS | Twilio | Stubbed initially |
| Accounting sync | Xero API | Two-way sync; AP + AR; TPAR via Xero |
| IDE | Windsurf / Cursor + Clasp | |
| Version control | GitHub | Auto-deploy to Cloudflare |

---

## 3. Multi-Tenancy Architecture

### Core principle
Every table includes a `tenant_id UUID` foreign key. Supabase Row Level Security (RLS) policies enforce that users can only ever read and write rows belonging to their own tenant. This isolation is enforced at the database layer — not in application code.

### Tenant isolation pattern
```sql
-- Applied to every table
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON jobs
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));
```

### Tenant setup
- One Supabase project for all tenants
- Each licensee gets one tenant row
- Users belong to a tenant via the `users` table
- Tenant admin can invite additional users under their tenant

---

## 4. Database Schema

### 4.1 tenants
```sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,           -- url-safe identifier e.g. "irc-perth"
  job_prefix TEXT NOT NULL,            -- e.g. "IRC" — job numbers IRC1001, IRC1002
  job_sequence INTEGER DEFAULT 1000,   -- starting number for job sequence
  plan TEXT DEFAULT 'solo',            -- 'solo' | 'team' | 'enterprise'
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  logo_storage_path TEXT,              -- path in Supabase Storage
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.2 users
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL,                  -- 'admin' | 'inspector' | 'office'
  phone TEXT,
  address TEXT,
  is_emergency_contact BOOLEAN DEFAULT false,
  makesafe_available BOOLEAN DEFAULT false,
  -- Permission flags (override role defaults)
  can_send_to_insurer BOOLEAN,         -- null = use role default
  can_edit_settings BOOLEAN,           -- null = use role default
  can_approve_invoices BOOLEAN,        -- null = use role default
  can_manage_scope_library BOOLEAN,    -- null = use role default
  can_view_financials BOOLEAN,         -- null = use role default
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Role defaults (applied when permission flag is null):**

| Permission | admin | office | inspector |
|---|---|---|---|
| can_send_to_insurer | ✓ | ✓ | ✗ |
| can_edit_settings | ✓ | ✗ | ✗ |
| can_approve_invoices | ✓ | ✓ | ✗ |
| can_manage_scope_library | ✓ | ✗ | ✗ |
| can_view_financials | ✓ | ✓ | ✗ |

### 4.3 clients
```sql
-- Insurers, adjuster firms, and other/private clients
-- This is the master reference for all external parties IRC works with
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  client_type TEXT NOT NULL,           -- 'insurer' | 'adjuster_firm' | 'other'
  parent_id UUID REFERENCES clients(id), -- links individual adjuster contacts to their firm
  name TEXT NOT NULL,                  -- e.g. "Allianz", "Sedgwick", "John Smith"
  trading_name TEXT,
  abn TEXT,
  submission_email TEXT,               -- primary reports submission email
  contact_phone TEXT,
  address TEXT,
  -- Per-insurer KPI configuration
  kpi_contact_hours NUMERIC DEFAULT 2,
  kpi_booking_hours NUMERIC DEFAULT 24,
  kpi_visit_days NUMERIC DEFAULT 2,
  kpi_report_days NUMERIC DEFAULT 4,
  send_booking_confirmation BOOLEAN DEFAULT false,
  notes TEXT,
  status TEXT DEFAULT 'active',        -- 'active' | 'inactive'
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.4 insurer_orders
```sql
CREATE TABLE insurer_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  job_id UUID REFERENCES jobs(id),     -- null until linked to a job; many-to-one with jobs
  client_id UUID REFERENCES clients(id), -- links to clients table (insurer or adjuster firm)
  order_ref TEXT,                      -- insurer's reference number
  status TEXT DEFAULT 'pending',       -- 'pending' | 'approved' | 'linked' | 'rejected'
  claim_number TEXT NOT NULL,          -- universal job key — always present
  insurer TEXT,                        -- denormalised for speed/display
  adjuster TEXT,                       -- denormalised for speed/display
  wo_type TEXT,                        -- 'BAR' | 'make_safe' | 'roof_report' | 'specialist' | 'variation' | 'quote_only'
  is_make_safe BOOLEAN DEFAULT false,  -- explicit flag for fast-track routing
  property_address TEXT,
  insured_name TEXT,
  insured_phone TEXT,
  insured_email TEXT,
  additional_contacts TEXT,
  date_of_loss DATE,
  loss_type TEXT,
  claim_description TEXT,
  special_instructions TEXT,
  sum_insured_building NUMERIC,
  excess_building NUMERIC,
  raw_email_link TEXT,
  parse_status TEXT,                   -- 'auto_parsed' | 'manual_entry' | 'needs_review'
  entry_method TEXT DEFAULT 'email',   -- 'email' | 'phone' | 'manual'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.5 jobs
```sql
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  job_number TEXT NOT NULL,            -- generated: {prefix}{sequence} e.g. IRC1001
  claim_number TEXT,                   -- 1:1 with real-world claim; unique per tenant
  client_id UUID REFERENCES clients(id), -- primary client (insurer or adjuster firm)
  insurer TEXT,                        -- denormalised for speed/display
  adjuster TEXT,                       -- denormalised for speed/display
  property_address TEXT,
  insured_name TEXT,
  insured_phone TEXT,
  insured_email TEXT,
  additional_contacts TEXT,
  date_of_loss DATE,
  loss_type TEXT,
  claim_description TEXT,
  special_instructions TEXT,
  sum_insured NUMERIC,
  excess NUMERIC,
  assigned_to UUID REFERENCES users(id),
  status TEXT DEFAULT 'active',        -- 'active' | 'on_hold' | 'complete' | 'cancelled'
  -- KPI tracking
  kpi_contact_due TIMESTAMPTZ,
  kpi_booking_due TIMESTAMPTZ,
  kpi_visit_due TIMESTAMPTZ,
  kpi_report_due TIMESTAMPTZ,
  kpi_contacted_at TIMESTAMPTZ,        -- set when acknowledgement SMS fires
  kpi_booked_at TIMESTAMPTZ,           -- set when inspection confirmed
  kpi_visited_at TIMESTAMPTZ,          -- set when field app safety tick fires
  kpi_reported_at TIMESTAMPTZ,         -- set when report sent to insurer
  notes TEXT,
  automation_overrides JSONB DEFAULT '{}', -- per-job automation overrides
  -- e.g. {"gary_enabled": false, "gary_deadline_hours": 168, "homeowner_sms_enabled": false}
  -- gary_enabled: false disables Gary SMS for this job (e.g. deceased estate, legal hold)
  -- Any key here overrides the matching automation_config value for this job only
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, job_number)
);
```

**Job number generation function:**
```sql
CREATE OR REPLACE FUNCTION generate_job_number(p_tenant_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_prefix TEXT;
  v_seq INTEGER;
  v_job_number TEXT;
BEGIN
  UPDATE tenants
  SET job_sequence = job_sequence + 1
  WHERE id = p_tenant_id
  RETURNING job_prefix, job_sequence INTO v_prefix, v_seq;

  v_job_number := v_prefix || v_seq::TEXT;
  RETURN v_job_number;
END;
$$ LANGUAGE plpgsql;
```

**Job margin computed view:**
```sql
CREATE OR REPLACE VIEW job_margin_summary AS
SELECT
  j.id AS job_id,
  j.tenant_id,
  j.job_number,
  j.insured_name,
  j.status,
  COALESCE(SUM(CASE WHEN si.approval_status = 'approved' THEN si.line_total ELSE 0 END), 0) AS approved_quote_total,
  COALESCE(SUM(CASE WHEN i.direction = 'outbound' AND i.status != 'voided' THEN i.amount_ex_gst ELSE 0 END), 0) AS total_invoiced_ex_gst,
  COALESCE(SUM(CASE WHEN i.direction = 'inbound' AND i.status = 'approved' THEN i.amount_ex_gst ELSE 0 END), 0) AS total_trade_cost_ex_gst,
  COALESCE(SUM(CASE WHEN i.direction = 'outbound' AND i.status != 'voided' THEN i.amount_ex_gst ELSE 0 END), 0)
  - COALESCE(SUM(CASE WHEN i.direction = 'inbound' AND i.status = 'approved' THEN i.amount_ex_gst ELSE 0 END), 0)
  AS gross_margin_ex_gst
FROM jobs j
LEFT JOIN quotes q ON q.job_id = j.id AND q.is_active_version = true
LEFT JOIN scope_items si ON si.quote_id = q.id
LEFT JOIN invoices i ON i.job_id = j.id
GROUP BY j.id, j.tenant_id, j.job_number, j.insured_name, j.status;
```

### 4.6 inspections
```sql
CREATE TABLE inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  quote_id UUID REFERENCES quotes(id),
  report_id UUID REFERENCES reports(id),
  inspection_ref TEXT,                 -- e.g. INSP-IRC1003-001
  scheduled_date DATE,
  scheduled_time TIME,
  inspector_id UUID REFERENCES users(id),
  status TEXT DEFAULT 'unscheduled',
    -- 'unscheduled' | 'urgent_awaiting_assignment' | 'proposed' |
    -- 'awaiting_reschedule' | 'confirmed' | 'in_progress' | 'submitted' | 'complete' | 'cancelled'
  insured_notified BOOLEAN DEFAULT false,
  scheduling_sms_sent_at TIMESTAMPTZ,
  scheduling_sms_response TEXT,
  booking_confirmed_at TIMESTAMPTZ,
  access_notes TEXT,
  calendar_event_id TEXT,
  field_draft JSONB,
  form_submitted_at TIMESTAMPTZ,
  safety_confirmed_at TIMESTAMPTZ,
  person_met TEXT,
  scope_status TEXT DEFAULT 'pending',   -- 'pending' | 'parsed' | 'reviewed'
  report_status TEXT DEFAULT 'pending',  -- 'pending' | 'draft' | 'reviewed' | 'sent'
  photos_status TEXT DEFAULT 'pending',  -- 'pending' | 'uploaded' | 'labelled'
  send_checklist JSONB DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.7 safety_records
```sql
CREATE TABLE safety_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  inspection_id UUID REFERENCES inspections(id),
  type TEXT,                           -- 'pre_inspection' | 'make_safe' | 'trade'
  inspector_id UUID REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  date DATE,
  status TEXT,
  signed_by TEXT,
  nearest_hospital TEXT,
  ppe_confirmed BOOLEAN,
  hazards_noted TEXT,
  custom_notes TEXT,
  roof_access BOOLEAN,
  structural_ok BOOLEAN,
  asbestos_risk BOOLEAN,
  lone_worker_checkin_active BOOLEAN DEFAULT false,
  lone_worker_checkin_interval_mins INTEGER,
  signature_data TEXT,
  pdf_storage_path TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.8 reports
```sql
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  inspection_id UUID REFERENCES inspections(id),
  quote_id UUID REFERENCES quotes(id),
  parent_report_id UUID REFERENCES reports(id),
  report_ref TEXT,
  version INTEGER DEFAULT 1,
  is_locked BOOLEAN DEFAULT false,
  report_type TEXT NOT NULL,           -- 'BAR' | 'storm_wind' | 'make_safe' | 'roof' | 'specialist'
  status TEXT DEFAULT 'draft',         -- 'draft' | 'complete' | 'sent' | 'cancelled'
  attendance_date DATE,
  attendance_time TIME,
  person_met TEXT,
  property_address TEXT,
  insured_name TEXT,
  claim_number TEXT,
  loss_type TEXT,
  assessor_name TEXT,
  property_description TEXT,
  incident_description TEXT,
  cause_of_damage TEXT,
  how_damage_occurred TEXT,
  resulting_damage TEXT,
  conclusion TEXT,
  pre_existing_conditions TEXT,
  maintenance_notes TEXT,
  raw_report_dump TEXT,
  damage_template TEXT,
  damage_template_saved BOOLEAN DEFAULT true,
  type_specific_fields JSONB DEFAULT '{}',
  doc_storage_path TEXT,
  pdf_storage_path TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.9 quotes
```sql
CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  inspection_id UUID REFERENCES inspections(id),
  report_id UUID REFERENCES reports(id),
  parent_quote_id UUID REFERENCES quotes(id),
  quote_ref TEXT,
  quote_type TEXT,                     -- 'inspection' | 'variation' | 'additional_works'
  version INTEGER DEFAULT 1,
  is_active_version BOOLEAN DEFAULT true,
  is_locked BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'draft',         -- 'draft' | 'ready' | 'sent' | 'approved' | 'partially_approved' | 'rejected'
  approved_amount NUMERIC,
  approval_notes TEXT,
  raw_scope_notes TEXT,
  total_amount NUMERIC,
  markup_pct NUMERIC DEFAULT 0.20,
  gst_pct NUMERIC DEFAULT 0.10,
  doc_storage_path TEXT,
  pdf_storage_path TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.10 scope_items
```sql
CREATE TABLE scope_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  quote_id UUID NOT NULL REFERENCES quotes(id),
  scope_library_id UUID REFERENCES scope_library(id),
  room TEXT,
  room_length NUMERIC,
  room_width NUMERIC,
  room_height NUMERIC,
  trade TEXT,
  keyword TEXT,
  item_description TEXT,
  unit TEXT,
  qty NUMERIC,
  rate_labour NUMERIC,
  rate_materials NUMERIC,
  rate_total NUMERIC,
  line_total NUMERIC,
  split_type TEXT,                     -- null | 'labour' | 'materials'
  approval_status TEXT DEFAULT 'pending', -- 'pending' | 'approved' | 'declined'
  is_custom BOOLEAN DEFAULT false,
  library_writeback_approved BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.11 scope_library
```sql
CREATE TABLE scope_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  insurer_specific TEXT,               -- null = applies to all (default fallback)
  pair_id UUID,
  split_type TEXT,                     -- null | 'labour' | 'materials'
  trade TEXT,
  keyword TEXT,
  item_description TEXT,
  unit TEXT,
  labour_rate_per_hour NUMERIC,
  labour_per_unit NUMERIC,
  materials_per_unit NUMERIC,
  total_per_unit NUMERIC,
  -- Scheduling fields (v3.0)
  estimated_hours NUMERIC,             -- labour hours per unit; drives work order duration calc
  has_lag BOOLEAN DEFAULT false,       -- true if this line item requires a waiting period
  lag_days INTEGER,                    -- null if has_lag = false
  lag_description TEXT,                -- e.g. "drying time" — shown on work order PDF and trade portal
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.12 report_templates
```sql
CREATE TABLE report_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  report_type TEXT NOT NULL,           -- 'BAR' | 'storm_wind' | 'make_safe' | 'roof'
  loss_types TEXT[],
  use_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.13 trades
```sql
CREATE TABLE trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  primary_trade TEXT,
  trade_code TEXT,
  business_name TEXT,
  entity_name TEXT,
  abn TEXT,
  primary_contact TEXT,
  address TEXT,                        -- physical/business address; used for proximity calculation
  lat NUMERIC,                         -- geocoded latitude; populated on save if address provided
  lng NUMERIC,                         -- geocoded longitude; populated on save if address provided
  contact_email TEXT,
  contact_mobile TEXT,
  contact_office TEXT,
  can_do_make_safe BOOLEAN DEFAULT false,
  makesafe_priority INTEGER,
  can_do_reports BOOLEAN DEFAULT false,
  -- Scheduling fields (v3.0)
  availability TEXT DEFAULT 'maintain_capacity',
    -- 'more_capacity' | 'maintain_capacity' | 'reduce_capacity' | 'on_pause'
  priority_rank INTEGER DEFAULT 50,    -- lower number = higher priority
  -- Gary fields
  gary_opt_out BOOLEAN DEFAULT false,
  gary_contact_preference TEXT,        -- 'sms' | 'email' | null
  gary_notes TEXT,
  status TEXT DEFAULT 'active',
  status_note TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.14 work_orders
```sql
-- scheduled_date REMOVED in v3.0 — scheduling lives in work_order_visits
CREATE TABLE work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  quote_id UUID REFERENCES quotes(id),
  trade_id UUID REFERENCES trades(id),
  report_id UUID REFERENCES reports(id),
  blueprint_id UUID REFERENCES job_schedule_blueprints(id),
  work_type TEXT,                      -- 'make_safe' | 'repair' | 'investigation'
  status TEXT DEFAULT 'pending',
    -- 'pending' | 'engaged' | 'works_complete' | 'invoice_received'
  -- Scheduling (v3.0)
  sequence_order INTEGER,
  is_concurrent BOOLEAN DEFAULT false,
  predecessor_work_order_id UUID REFERENCES work_orders(id),
  estimated_hours NUMERIC,
  total_visits INTEGER DEFAULT 1,
  current_visit INTEGER DEFAULT 1,
  proximity_range TEXT,                -- 'standard' | 'extended'
  gary_state TEXT DEFAULT 'not_started',
    -- 'not_started' | 'waiting_on_dependent' | 'waiting_reply' | 'booking_proposed'
    -- | 'confirmed' | 'return_visit_pending' | 'complete'
  -- Financials
  scope_summary TEXT,
  trade_cost NUMERIC,
  charge_out_amount NUMERIC,
  agreed_amount NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.14a work_order_visits
```sql
CREATE TABLE work_order_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  work_order_id UUID NOT NULL REFERENCES work_orders(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  visit_number INTEGER NOT NULL,
  estimated_hours NUMERIC,
  scheduled_date DATE,
  scheduled_end_date DATE,
  confirmed_date DATE,
  status TEXT DEFAULT 'unscheduled',
    -- 'unscheduled' | 'gary_sent' | 'proposed' | 'confirmed' | 'complete'
  lag_days_after INTEGER DEFAULT 0,
  lag_description TEXT,
  gary_triggered_at TIMESTAMPTZ,
  gary_return_trigger_at TIMESTAMPTZ,
  trade_confirmed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.14b job_schedule_blueprints
```sql
CREATE TABLE job_schedule_blueprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  status TEXT DEFAULT 'draft',         -- 'draft' | 'confirmed' | 'superseded'
  draft_data JSONB,
  confirmed_by UUID REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.14c trade_type_sequence
```sql
CREATE TABLE trade_type_sequence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  trade_type TEXT NOT NULL,
  typical_sequence_order INTEGER,
  typical_visit_count INTEGER DEFAULT 1,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, trade_type)
);
```

**Seeded on tenant creation with IRC defaults:**

| trade_type | typical_sequence_order | typical_visit_count | notes |
|---|---|---|---|
| electrician | 10 | 2 | Disconnect first visit; reconnect last visit |
| plumber | 15 | 2 | Disconnect first visit; reconnect last visit |
| demolition | 20 | 1 | |
| plasterer | 30 | 2 | Strip visit + reinstate visit; lag between |
| carpenter | 40 | 1 | |
| tiler | 50 | 1 | |
| painter | 60 | 1 | Follows plasterer; check lag complete |
| roofer | 25 | 1 | Often independent; can run concurrent |

### 4.15 communications
```sql
CREATE TABLE communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  job_id UUID REFERENCES jobs(id),
  inspection_id UUID REFERENCES inspections(id),
  work_order_id UUID REFERENCES work_orders(id),
  type TEXT NOT NULL,                  -- 'sms' | 'email' | 'phone' | 'note' | 'portal'
  direction TEXT,                      -- 'inbound' | 'outbound' | null for notes
  contact_type TEXT,                   -- 'insured' | 'insurer' | 'trade' | 'internal'
  contact_name TEXT,
  contact_detail TEXT,
  subject TEXT,
  content TEXT,
  attachments JSONB DEFAULT '[]',
  ai_extracted_notes TEXT,
  requires_action BOOLEAN DEFAULT false,
  action_queue_id UUID REFERENCES action_queue(id),
  persona TEXT,                        -- 'gary' | 'client_comms_bot' | 'human' | null
  parse_confidence TEXT,               -- 'high' | 'low' | null
  linked_to TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.16 photos
```sql
CREATE TABLE photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  inspection_id UUID REFERENCES inspections(id),
  storage_path TEXT NOT NULL,
  label TEXT,
  report_code TEXT,
  sequence_number INTEGER,
  file_name TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  uploaded_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.17 invoices
```sql
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  work_order_id UUID REFERENCES work_orders(id),
  report_id UUID REFERENCES reports(id),
  invoice_ref TEXT,
  invoice_type TEXT NOT NULL,
    -- AP: 'trade_invoice'
    -- AR: 'assessment' | 'make_safe' | 'repair' | 'specialist_passthrough'
  direction TEXT NOT NULL,             -- 'inbound' (AP) | 'outbound' (AR)
  trade_id UUID REFERENCES trades(id),
  trade_invoice_number TEXT,
  trade_invoice_date DATE,
  trade_pdf_storage_path TEXT,
  trade_abn TEXT,
  amount_ex_gst NUMERIC,
  gst NUMERIC,
  amount_inc_gst NUMERIC,
  status TEXT DEFAULT 'draft',
  external_status TEXT,
  parse_status TEXT,
  issued_date DATE,
  paid_date DATE,
  xero_invoice_id TEXT,
  xero_sync_status TEXT DEFAULT 'pending',
  xero_sync_error TEXT,
  xero_last_synced_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.18 email_templates
```sql
CREATE TABLE email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  send_type TEXT NOT NULL,
  client_id UUID REFERENCES clients(id),
  subject_template TEXT,
  body_template TEXT,
  is_default BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.19 automation_config
```sql
CREATE TABLE automation_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, key)
);
-- Default values seeded on tenant creation:
-- Gary timing (now in days, not hours):
-- gary_response_deadline_days: 2
-- gary_reminder_1_days: 1
-- gary_final_nudge_days: 2
-- gary_send_window_start: "06:00"
-- gary_send_window_end: "19:00"
-- gary_send_window_tz: "Australia/Perth"
-- Business hours & time mode settings:
-- business_hours_start: "07:00"
-- business_hours_end: "17:30"
-- business_days: "1,2,3,4,5" (ISO weekday numbers, 1=Mon)
-- public_holidays: "[]" (JSON array of YYYY-MM-DD strings)
-- waking_hours_start: "07:00"
-- waking_hours_end: "20:00"
-- urgent_hours_start: "05:00"
-- urgent_hours_end: "22:00"
-- urgent_all_days: "true"
-- Other automation settings:
-- makesafe_cascade_wait_minutes: 15
-- makesafe_cascade_max_trades: 5
-- trade_portal_token_expiry_days_after_close: 30
-- homeowner_followup_max_attempts: 2
-- homeowner_followup_interval_hours: 24
-- trade_proximity_standard_km: 40    (v3.0 addition)
```

### 4.19a Business Hours & Time Mode System

IRC Master uses a time-aware automation system that controls when messages are sent and how delays are calculated. All time-related logic lives in `/lib/scheduling/business-hours.ts` — this is the single source of truth for time mode behavior.

#### Time Modes

Each automation rule declares a `time_mode` that controls both delivery gating (when to send) and delay calculation (how to calculate next event time).

| Mode | Delivery Gating | Delay Unit Used | Description |
|---|---|---|---|
| `business_hours` | Mon–Fri, within business hours, non-holiday | `business_days` | Trade follow-up timelines and trade-facing comms |
| `waking_hours` | Any day, within waking hours | `calendar_days` | Homeowner and insured SMS |
| `urgent` | Any day, within urgent hours (5am–10pm default) | `calendar_days` | Make safe cascade and emergency dispatch |
| `send_window` | Any day, within Gary send window | `calendar_days` | Gary trade SMS |

#### Delay Units

The unit of a delay is a semantic fact about what a timer means. It is hardcoded in the rule definition and is NOT user-configurable.

| Unit | Calculation | Example Use |
|---|---|---|
| `minutes` | startTime + value minutes | Make safe cascade (time-critical) |
| `hours` | startTime + value hours | KPI contact/booking SLAs (real-time) |
| `calendar_days` | startTime + value calendar days | Homeowner follow-ups, Gary return visits |
| `business_days` | Count only business days (weekdays in business_days, not holidays) | Gary escalation deadlines, KPI visit/report due dates |

#### automation_config Keys

**Business Hours Settings:**
- `business_hours_start`: Start of business day HH:MM 24hr (default "07:00")
- `business_hours_end`: End of business day HH:MM 24hr (default "17:30")
- `business_days`: ISO weekday numbers counted as business days (default "1,2,3,4,5")
- `public_holidays`: JSON array of YYYY-MM-DD strings (manually maintained annually)

**Waking Hours (Homeowner/Insured Comms):**
- `waking_hours_start`: Earliest time for homeowner/insured comms (default "07:00")
- `waking_hours_end`: Latest time for homeowner/insured comms (default "20:00")

**Urgent Mode (Make Safe & Emergency):**
- `urgent_hours_start`: Earliest time for urgent mode comms (default "05:00")
- `urgent_hours_end`: Latest time for urgent mode comms (default "22:00")
- `urgent_all_days`: If true urgent mode runs all 7 days (default "true")

**Gary Send Window:**
- `gary_send_window_start`: Gary trade SMS window start (default "06:00")
- `gary_send_window_end`: Gary trade SMS window end (default "19:00")
- `gary_send_window_tz`: Timezone for all time calculations (default "Australia/Perth")

#### Per-Job Automation Overrides

The `jobs.automation_overrides` JSONB field allows per-job overrides of time mode behavior:

```typescript
{
  // Existing keys
  gary_enabled?: boolean
  gary_deadline_hours?: number
  homeowner_sms_enabled?: boolean
  gary_send_window_start?: string
  gary_send_window_end?: string
  
  // Time mode overrides (new)
  time_mode_override?: 'business_hours' | 'waking_hours' | 'urgent' | 'send_window' | null
  insured_contact_window_start?: string
  insured_contact_window_end?: string
  insured_contact_all_days?: boolean
  trade_contact_overrides?: Record<string, {
    contact_window_start?: string
    contact_window_end?: string
    contact_all_days?: boolean
  }>
}
```

Override resolution order (most specific wins):
1. `trade_contact_overrides[tradeId]` — trade-specific override
2. `insured_contact_window_start/end` — insured-specific override
3. `time_mode_override` — job-level mode override
4. Rule-level `time_mode` — rule default
5. Global `automation_config` values — tenant defaults

#### Core Functions (`/lib/scheduling/business-hours.ts`)

- `parseTimeConfig(rawConfig)`: Converts automation_config strings to typed TimeConfig
- `isWithinSendWindow(config, mode, at?)`: Returns true if current time is within valid delivery window
- `getNextSendTime(config, mode, referenceTime?)`: Returns next valid delivery time
- `addDelay(config, startTime, value, unit)`: Calculates timestamp after adding delay
- `resolveEffectiveTimeConfig(config, mode, jobOverrides?, contactType?, tradeId?)`: Resolves effective window considering overrides

#### KPI Due Date Calculations

KPI due dates are calculated using `addDelay()` when jobs are created:

- `kpi_contact_due`: `addDelay(config, orderedAt, 2, 'hours')` — calendar hours (insurer SLA is real-time)
- `kpi_booking_due`: `addDelay(config, orderedAt, 24, 'hours')` — calendar hours (same reason)
- `kpi_visit_due`: `addDelay(config, orderedAt, 2, 'business_days')` — business days (industry standard)
- `kpi_report_due`: `addDelay(config, orderedAt, 4, 'business_days')` — business days

Contact and booking use calendar hours because insurer SLAs are real-time (weekends don't pause the clock). Visit and report use business days because inspections happen during working days.

#### UI Configuration

- Settings page: `/dashboard/settings/automation` — configure business hours, waking hours, urgent mode, and Gary send window
- Job detail page: Overview tab includes Automation Overrides accordion for per-job settings
- Per-job overrides support: time mode override, custom insured contact window, trade-specific contact windows

### 4.20 rate_config
```sql
CREATE TABLE rate_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  report_type TEXT NOT NULL,
  min_charge NUMERIC,
  standard_charge NUMERIC,
  margin_pct NUMERIC,
  gst_pct NUMERIC DEFAULT 0.10,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.21 portal_tokens
```sql
CREATE TABLE portal_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  work_order_id UUID NOT NULL REFERENCES work_orders(id),
  token TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.22 job_flags
```sql
CREATE TABLE job_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, job_id, user_id)
);
```

### 4.23 job_notes
```sql
CREATE TABLE job_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  content TEXT NOT NULL,
  is_pinned BOOLEAN DEFAULT false,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.24 scope_library_history
```sql
CREATE TABLE scope_library_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  scope_library_id UUID NOT NULL REFERENCES scope_library(id),
  snapshot JSONB NOT NULL,
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.25 audit_log
```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  before_state JSONB,
  after_state JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.26 prompts
```sql
CREATE TABLE prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
    -- 'report' | 'scope' | 'photo' | 'comms_trade' | 'comms_client' | 'action_queue' | 'portal' | 'scheduling'
  report_type TEXT,
  system_prompt TEXT NOT NULL,
  previous_prompt TEXT,
  notes TEXT,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, key)
);
```

**Prompt inventory (seeded on tenant creation):**

| Key | Name | Category |
|---|---|---|
| `report_bar` | BAR Report Generation | report |
| `report_roof` | Roof Report Generation | report |
| `report_make_safe` | Make Safe Report Generation | report |
| `report_specialist` | Specialist Report Generation | report |
| `scope_parse` | Scope Parsing | scope |
| `photo_label` | Photo Labelling | photo |
| `photo_label_roof` | Roof Photo Labelling | photo |
| `comms_gary` | Gary — Trade Comms Identity | comms_trade |
| `comms_client_bot` | Client Comms Bot — Homeowner/Insurer | comms_client |
| `action_queue_draft` | Action Queue Draft Generation | action_queue |
| `portal_update` | Insurer Portal Update | portal |
| `sms_inspection_booking_proposal` | Inspection Booking Proposal SMS | scheduling |
| `sms_inspection_reschedule` | Inspection Reschedule SMS | scheduling |
| `sms_inspection_cancellation` | Inspection Cancellation SMS | scheduling |
| `sms_trade_return_visit` | Trade Return Visit SMS | scheduling |
| `schedule_blueprint_draft` | Schedule Blueprint AI Draft | scheduling |

### 4.27 action_queue
```sql
CREATE TABLE action_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  rule_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  ai_draft JSONB,
  status TEXT DEFAULT 'pending',       -- 'pending' | 'confirmed' | 'skipped' | 'snoozed'
  priority INTEGER DEFAULT 50,
  snoozed_until TIMESTAMPTZ,
  confirmed_by UUID REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  error_log TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 5. Supabase Storage Structure

```
/tenants/{tenant_id}/
  /jobs/{job_id}/
    /photos/           -- inspection photos
    /job-photos/       -- job-level photos (never sent in inspection sends)
    /reports/
    /quotes/
    /docs/
    /safety/
    /invoices/
  /logos/
```

---

## 5b. Database Indexes

```sql
CREATE INDEX idx_jobs_tenant_status ON jobs(tenant_id, status);
CREATE INDEX idx_jobs_tenant_created ON jobs(tenant_id, created_at DESC);
CREATE INDEX idx_jobs_claim_number ON jobs(tenant_id, claim_number);
CREATE INDEX idx_inspections_job ON inspections(job_id);
CREATE INDEX idx_inspections_tenant_status ON inspections(tenant_id, status);
CREATE INDEX idx_inspections_scheduled ON inspections(tenant_id, scheduled_date);
CREATE INDEX idx_reports_job ON reports(job_id);
CREATE INDEX idx_reports_inspection ON reports(inspection_id);
CREATE INDEX idx_reports_tenant_status ON reports(tenant_id, status);
CREATE INDEX idx_quotes_job ON quotes(job_id);
CREATE INDEX idx_quotes_inspection ON quotes(inspection_id);
CREATE INDEX idx_scope_items_quote ON scope_items(quote_id);
CREATE INDEX idx_photos_job ON photos(job_id);
CREATE INDEX idx_photos_inspection ON photos(inspection_id);
CREATE INDEX idx_comms_job ON communications(job_id);
CREATE INDEX idx_comms_tenant_created ON communications(tenant_id, created_at DESC);
CREATE INDEX idx_comms_requires_action ON communications(tenant_id, requires_action) WHERE requires_action = true;
CREATE INDEX idx_action_queue_tenant_status ON action_queue(tenant_id, status, job_id);
CREATE INDEX idx_action_queue_pending ON action_queue(tenant_id, status) WHERE status = 'pending';
CREATE INDEX idx_insurer_orders_tenant_status ON insurer_orders(tenant_id, status);
CREATE INDEX idx_insurer_orders_job ON insurer_orders(job_id);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_tenant_created ON audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_job_notes_job ON job_notes(job_id);
CREATE INDEX idx_job_notes_pinned ON job_notes(job_id, is_pinned) WHERE is_pinned = true;
CREATE INDEX idx_job_flags_user ON job_flags(user_id, tenant_id);
CREATE INDEX idx_portal_tokens_work_order ON portal_tokens(work_order_id);
CREATE INDEX idx_portal_tokens_token ON portal_tokens(token);
-- v3.0 additions
CREATE INDEX idx_work_order_visits_work_order ON work_order_visits(work_order_id);
CREATE INDEX idx_work_order_visits_job ON work_order_visits(job_id);
CREATE INDEX idx_work_order_visits_scheduled ON work_order_visits(tenant_id, scheduled_date);
CREATE INDEX idx_work_order_visits_gary_trigger ON work_order_visits(gary_return_trigger_at) WHERE gary_return_trigger_at IS NOT NULL;
CREATE INDEX idx_blueprints_job ON job_schedule_blueprints(job_id);
```

---

## 6. Authentication

### Flow
1. User enters email address
2. Supabase sends magic link email
3. User clicks link — authenticated session created
4. Session persists in browser (30 day expiry, refreshed on activity)

### Session persistence
- Use Supabase's built-in session persistence
- `supabase.auth.getSession()` on app load
- `supabase.auth.onAuthStateChange()` for reactive updates

---

## 7. Application Structure

### Next.js App Router structure
```
/app
  /layout.tsx
  /page.tsx
  /login/page.tsx
  /dashboard/
    /layout.tsx
    /page.tsx
    /calendar/
      /page.tsx                        -- global calendar (inspections + trades modes)
    /jobs/
      /page.tsx
      /[jobId]/page.tsx                -- includes Calendar tab in tab bar
    /inspections/
      /page.tsx
      /[inspectionId]/page.tsx
    /reports/
      /page.tsx
      /[reportId]/page.tsx
    /quotes/
      /page.tsx
      /[quoteId]/page.tsx
    /insurer-orders/
      /page.tsx
    /clients/
      /page.tsx
      /[clientId]/page.tsx
    /trades/
      /page.tsx
    /work-orders/
      /page.tsx
    /communications/
      /page.tsx
    /settings/
      /page.tsx
      /prompts/page.tsx
      /scope-library/page.tsx
      /email-templates/page.tsx
      /trade-sequence/page.tsx         -- trade type sequence config (admin only)
  /trade-portal/
    /[workOrderToken]/page.tsx
  /api/
    /pdf/route.ts
    /ai/parse-scope/route.ts
    /ai/generate-report/route.ts
    /ai/label-photos/route.ts
    /ai/parse-invoice/route.ts
    /ai/action-queue/route.ts
    /ai/execute-action/route.ts
    /ai/config-update/route.ts
    /ai/draft-blueprint/route.ts       -- calls Claude to generate blueprint draft_data
    /email/send/route.ts
    /xero/sync/route.ts
    /xero/webhook/route.ts
    /trade-portal/upload/route.ts
    /scheduling/
      /sms-send/route.ts
      /gary-return-visit/route.ts
    /webhooks/
      /twilio/route.ts
      /email-inbound/route.ts

/lib
  /automation/
    /rules.ts
    /engine.ts
    /executor.ts
    /step-handlers/
      /send-sms.ts
      /send-email.ts
      /update-status.ts
      /create-record.ts
      /add-note.ts
      /generate-pdf.ts
      /schedule-followup.ts
      /notify-internal.ts
  /scheduling/
    /blueprint-generator.ts
    /proximity.ts
    /visit-splitter.ts
    /gary-triggers.ts
```

---

## 8. Workflow Documentation

### WF-0: Platform Design Principles — LOCKED

#### Manual fallback principle
Every automated action has a manual fallback. Automations are accelerators — never the only path.

#### Dashboard design
- Left sidebar: black background, collapsible on mobile
- Main area: beige background
- Action queue is the dominant UI element on dashboard home

**Sidebar navigation links:**
Dashboard | Jobs | Inspections | Reports | Quotes | Insurer Orders | Calendar | Communications | Trades | Work Orders | Clients | Settings

**Job detail page tab bar:**
Summary | Inspections | Reports | Quotes | Work Orders | Calendar | Comms | Invoices | Photos | Notes

---

### WF-1: Insurer Order Arrival — LOCKED
- Orders arrive primarily by email; phone fallback for make safes only
- Claim number is the universal job key — one claim = one job, always
- Many insurer orders can link to one job
- Auto Job Lodger parses emails via Gemini Flash; human review required

### WF-2: Job Creation — LOCKED
- On lodge: auto-creates inspection + BAR report + quote
- Acknowledgement SMS fires on lodge (satisfies 2-hour contact KPI)

### WF-3: Inspection Scheduling — LOCKED
- KPI: 2hr contact / 24hr booking / 2-day visit / 4-day report (per insurer config)
- Full status progression: Unscheduled → Urgent Awaiting Assignment → Proposed → Awaiting Reschedule → Confirmed → In Progress → Submitted → Complete
- Phase 1: manual scheduling via global Calendar UI with drag-and-drop (see Section 20)

### WF-4: On-Site Inspection — LOCKED
- Field app flow: Safety → Person Met → Scope → Photos → Photo context dump → Report dump → Specialist referral → Submit
- Safety tick auto-timestamps inspection start, moves to In Progress, sets kpi_visited_at
- Scope: structured room/item capture — NOT a freeform dump box
- Photos: batch upload from native camera roll
- Multiple reports per submit: BAR + make safe job generates both in one submit
- Auto-save throughout; draft persists in field_draft JSONB

### WF-5: Post-Inspection Review & Send — LOCKED
- AI processing fires automatically on field app submit
- Inspection detail page is the central review hub — all items inline, all editable
- Status-driven completeness — automatic, no human tick required
- Send flow: review → tick items → Submit → warning if draft items → Gmail compose

### WF-6: Quote — Build, Review, Versioning & Approval — LOCKED
- Scope library matching: insurer-specific rows win over null (default)
- Once sent, is_locked flips to true — clone required to edit (variation)
- Partial approval: item-level approval_status per scope_item
- Approved items PDF: filtered PDF of approved scope items only

### WF-7: Sending to Insurer & Invoice Flow — LOCKED
- Submission package: BAR report + Quote + Photos PDF + additional reports + invoices
- Xero source of truth: IRC = invoice creation/voiding; Xero = payment status

### WF-8: Trades & Work Orders — LOCKED
- Gary: trade-facing AI identity; all trade SMS/email sign-offs
- Gary send window: 06:00–19:00 local time; queued outside window
- Per-job automation overrides via jobs.automation_overrides JSONB
- Make safe dispatch: Gary SMS cascade; configurable depth
- Trade ranking: availability tier → priority_rank → proximity → random tiebreak

### WF-9: Communications — LOCKED
- All inbound/outbound communications logged to communications table
- Single inbound email address; Gemini parses to job-link
- Prompt injection protection: structural separation + instruction-resistance framing
- Comms autonomy spectrum: 0 (human only) → 3 (fully autonomous)

### WF-10: Invoicing — LOCKED
- IRC invoices insurer for all work — never the insured
- Trade invoices submitted via work order portal (PDF drag/drop); parsed by Gemini Flash
- All invoices sync to Xero automatically; payment status syncs back as read-only

### WF-11: Supporting Tables & Configuration — LOCKED
- ~15 prompts total; one per functional area
- Three base roles: admin, inspector, office
- Per-user permission flags override role defaults

---

## 9. Brand and UI

```css
--irc-black: #1a1a1a;
--irc-beige: #f5f0e8;
--irc-beige-dark: #e8e0d0;
--irc-accent: #c9a96e;
```

- Left sidebar navigation (collapsible on mobile), black background
- Beige main content area
- Field app: full-screen mobile-first, large touch targets, 375px minimum width

---

## 10. PDF Generation

- Next.js API route `/api/pdf` → Railway Puppeteer service → PDF buffer → Supabase Storage
- Separate Node.js Express service on Railway (~$5-7/month)

---

## 11. AI Features

| Feature | Model | Trigger |
|---|---|---|
| Scope parsing | claude-sonnet-4-20250514 | Field app submit |
| Report generation | claude-sonnet-4-20250514 | Field app submit |
| Photo labelling | Gemini Flash 2.0 | Live in field app |
| Inbound SMS parsing | claude-sonnet-4-20250514 | Twilio webhook |
| Email/order parsing | Gemini Flash 2.0 | Email webhook |
| Schedule blueprint draft | claude-sonnet-4-20250514 | quote_approved action |
| Action queue draft | claude-sonnet-4-20250514 | action_queue row created |

### Automation engine — pure function design
`engine.ts` is a pure function: given current database state, it returns the set of action_queue rows that should exist. It never mutates any table except action_queue.

---

## 12. Future Modules

- **12.1** Inspection Run Scheduler (Phase 4+) — deferred until 6+ inspections/day
- **12.2** Make Safe Dispatch — urgent cascade; future module
- **12.3** External Trade Field App — future consideration
- **12.4** Insurer Portal Automation — Axiom compatibility TBD
- **12.5** AI Job Assistant Chat Widget — floating widget on job detail pages

---

## 13. Remaining Google Apps Script Automations

Personal/operational tools that remain as standalone Apps Script projects, interacting with IRC Master via Supabase REST API:
- IRC Health Check
- IRC ClaudeSync
- Auto Job Lodger (transitional)

---

## 14. Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
PDF_SERVICE_URL=
PDF_SERVICE_SECRET=
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
GOOGLE_MAPS_API_KEY=
NEXT_PUBLIC_APP_URL=
```

---

## 15. Data Migration Plan

Migration order (respects foreign keys):
1. tenants → 2. users → 3. clients → 4. trades → 5. scope_library → 6. trade_type_sequence → 7. insurer_orders → 8. jobs → 9. inspections → 10. reports → 11. quotes → 12. scope_items → 13. report_templates → 14. work_orders → 15. work_order_visits → 16. job_schedule_blueprints → 17. communications → 18. safety_records → 19. photos → 20. action_queue

Note: `scope_library` scheduling columns (`estimated_hours`, `has_lag`, `lag_days`, `lag_description`) require post-migration review. Seed `estimated_hours` where labour rate and quantity allow calculation.

---

## 16. Build Sequence (Recommended)

### Phase 1 — Foundation
1. Supabase project setup (schema, RLS, storage)
2. Next.js scaffold (TypeScript, Tailwind, shadcn/ui)
3. Cloudflare Pages deployment pipeline
4. Magic link auth + session persistence
5. Tenant + user setup flow
6. Seed `trade_type_sequence` with IRC defaults
7. Seed `scope_library` scheduling columns

### Phase 2 — Core data views
8. Jobs list and job detail page (including Calendar tab)
9. Inspections list and detail
10. Reports list and detail
11. Quotes list and scope editor
12. Insurer Orders list
13. Clients list and detail
14. Global Calendar page — Inspections mode + drag-and-drop scheduling

### Phase 3 — Active features
15. Claude scope parser
16. Claude report generator
17. PDF generation via Railway Puppeteer
18. Photo upload to Supabase Storage
19. Gemini photo labelling

### Phase 4 — Field app
20. Mobile field app
21. Safety record capture
22. Photo capture + compression
23. Field draft persistence
24. Live photo labelling trigger

### Phase 5 — Send workflow
25. In-app Gmail compose window
26. Inspection send checklist + completeness warnings
27. Send status updates + communications logging
28. AI prompt library management UI

### Phase 6 — Communications + trades
29. Communications log
30. Trades management (availability, priority_rank, address/geocoding)
31. Trade type sequence settings UI (`/settings/trade-sequence`)
32. Work orders (including work_order_visits, job_schedule_blueprints)
33. Global Calendar — Trades mode
34. Job-level Calendar tab — Timeline/Gantt view
35. SMS via Twilio

### Phase 6b — AI Action Queue + Schedule Blueprint
36. action_queue table + RLS + index
37. /lib/automation/rules.ts — first rules
38. /lib/automation/engine.ts
39. /lib/automation/executor.ts + step handlers
40. Dashboard action queue UI
41. Job detail action queue panel
42. /api/ai/action-queue and /api/ai/execute-action routes
43. Schedule blueprint AI draft generation
44. Blueprint review UI (Stage 1–2–3 flow)
45. Gary return visit trigger

### Phase 7 — Multi-tenancy + licensing
46. Tenant admin dashboard
47. User invitation flow
48. Licensing / onboarding flow
49. (Future) Automation rule builder UI

---

## 17. Key Constraints and Decisions

See full decisions table in the attached IRC_Master_Tech_Spec_v3_0.md source document. Key v3.0 additions:

- `scheduled_date` removed from work_orders — scheduling lives in work_order_visits
- Blueprint always required — no skip option even for single-trade jobs
- Visit structure at work_order_visits level — separate table, not JSONB on work_orders
- Lag at scope library line item level — `has_lag` + `lag_days` + `lag_description` per line
- Maximum lag wins per visit when multiple lag items exist in same visit
- Gary return visit trigger at 50% of lag elapsed
- Trade proximity stored on work_order, not trades table — distance is job-specific
- Blueprint draft_data as JSONB — stored before WO creation; review UI renders without creating DB records
- trade_type_sequence editable table seeded with IRC defaults, admin UI from day 1
- Manual scheduling always available regardless of Gary state

---

## 18. Open Questions / Parking Lot

- Axiom portal compatibility — double-entry problem not yet resolved
- Client Comms Bot name — TBD
- Xero API setup — not yet configured
- Inbound email address domain setup — DNS/forwarding config required
- Google Maps API key setup — required before blueprint draft generation
- `scope_library.estimated_hours` seeding — requires review of existing line items

---

## 19. AI Action Queue

### Concept
Proactive work surface — not a chatbot. System identifies pending work, surfaces as actionable cards, pre-drafts AI-suggested actions, executes full step chains on Confirm.

### UI pattern
Two-column scrollable card list. **Confirm** executes playbook. **Edit** opens draft for modification. **Skip** dismisses. **Snooze** hides until specified time.

### Playbook step types

| Step type | What it does |
|---|---|
| `send_sms` | Sends SMS via Twilio; logs to communications |
| `send_email` | Sends email via Gmail API; logs to communications |
| `update_status` | Updates field on jobs/inspections/reports/quotes/work_order_visits |
| `create_record` | Creates new report, work_order, work_order_visits, or communications record |
| `add_note` | Writes note to communications log |
| `generate_pdf` | Triggers Railway Puppeteer PDF generation |
| `schedule_followup` | Writes new action_queue row for timed follow-up |
| `notify_internal` | Creates in-app alert |
| `draft_blueprint` | Triggers AI blueprint draft; writes to job_schedule_blueprints |

### Rules architecture

All rules live in `/lib/automation/rules.ts`. Engine evaluates rules; executor runs steps. Neither file changes when rules are added.

```typescript
export type StepType =
  | 'send_sms' | 'send_email' | 'update_status' | 'create_record'
  | 'add_note' | 'generate_pdf' | 'schedule_followup' | 'notify_internal'
  | 'draft_blueprint'

export interface AutomationRule {
  key: string
  name: string
  description: string
  category: 'inspection' | 'report' | 'quote' | 'comms' | 'trade' | 'admin' | 'scheduling'
  active: boolean
  priority: number
  trigger: {
    entity: 'job' | 'inspection' | 'report' | 'quote' | 'work_order' | 'work_order_visit'
    status?: string
  }
  conditions: Array<
    | { type: 'linked_entity_missing'; entity: string }
    | { type: 'linked_entity_exists'; entity: string }
    | { type: 'days_since_updated'; days: number }
    | { type: 'field_equals'; field: string; value: unknown }
    | { type: 'no_pending_task'; rule_key: string }
  >
  playbook: PlaybookStep[]
  ai_prompt_context: string
}
```

**Example rule — quote approved, draft blueprint:**
```typescript
{
  key: 'quote_approved_draft_blueprint',
  name: 'Quote approved — draft repair schedule',
  description: 'Quote approved. AI drafts trade allocation, sequence, and visit structure for review.',
  category: 'scheduling',
  active: true,
  priority: 15,
  trigger: { entity: 'quote', status: 'approved' },
  conditions: [
    { type: 'linked_entity_missing', entity: 'job_schedule_blueprint' },
    { type: 'no_pending_task', rule_key: 'quote_approved_draft_blueprint' }
  ],
  playbook: [
    {
      step: 1,
      type: 'draft_blueprint',
      label: 'AI drafts repair schedule blueprint',
      config: {
        input: 'approved_scope_items + available_trades + trade_type_sequence',
        output: 'job_schedule_blueprints.draft_data'
      }
    },
    {
      step: 2,
      type: 'notify_internal',
      label: 'Notify team — schedule ready for review',
      config: { message: 'Repair schedule drafted for {job_number} — review and confirm to activate Gary.' }
    }
  ],
  ai_prompt_context: 'Quote approved. Summarise proposed trade sequence and highlight extended-range trades or unusual lag periods.'
}
```

---

## 20. Calendar & Scheduling

### 20.1 Overview

Two surfaces:
- **Global Calendar** (`/dashboard/calendar`) — all inspections and trade schedules across all jobs
- **Job-level Calendar Tab** — scoped to one job; Gantt-style timeline with dependency tracking

### 20.2 Trade Coordination Workflow

Triggered when a quote status moves to `approved`. Three stages:

#### Stage 1 — AI Blueprint Draft (Automated)
`quote_approved_draft_blueprint` rule fires. System reads approved scope_items, computes estimated_hours per trade type, ranks candidates by availability/priority/proximity, reads lag fields to build visit structure, calls Claude, writes to `job_schedule_blueprints` with `status = 'draft'`. No work orders created yet. No Gary fires yet.

**draft_data JSONB structure:**
```json
{
  "trades": [{
    "trade_type": "plasterer",
    "trade_id": "uuid",
    "trade_name": "ABC Plastering",
    "proximity_range": "standard",
    "availability": "more_capacity",
    "sequence_order": 1,
    "is_concurrent": false,
    "predecessor_index": null,
    "estimated_hours": 12,
    "visits": [
      { "visit_number": 1, "estimated_hours": 4, "lag_days_after": 14, "lag_description": "drying time" },
      { "visit_number": 2, "estimated_hours": 8, "lag_days_after": 0, "lag_description": null }
    ]
  }]
}
```

#### Stage 2 — Human Review
Action queue card opens Schedule Review UI. Three actions:
- **Confirm** → blueprint locked; work_orders + work_order_visits created; Gary fires for trades with no predecessor
- **Edit** → inline editing; re-confirm when done
- **Start from scratch** → clears draft; manual allocation UI

#### Stage 3 — Live Schedule (Dates Fill In Dynamically)
Gary runs booking loops; dates populated as trades confirm. Manual override always available.

### 20.3 Global Calendar (`/dashboard/calendar`)

**View Modes:** Schedule / Day / Week (default) / Month

**Mode A — Inspections:** All scheduled inspections; colour-coded by inspector; unscheduled panel (see 20.4)

**Mode B — Trades:** All confirmed work_order_visits; sub-filters by trade type/name

### 20.4 Unscheduled Inspection Panel

Right-side panel in Inspections mode. Cards draggable onto calendar. Drop triggers Confirm & Schedule modal with optional booking proposal SMS.

### 20.5 Job-Level Calendar Tab

Located in job detail tab bar. Two views:

**Timeline / Gantt (default):** Rows per inspection + work_order_visit; horizontal bars with status chips; lag gaps shown as hatched with description label; dependency arrows; lock icons on constrained bars.

**Mini Calendar view:** Week/month toggle; inspection + confirmed trade visit dates as chips.

### 20.6 Scheduling Key Decisions

| Decision | Choice |
|---|---|
| Blueprint always required | Yes — no skip option |
| Draft stored as JSONB before WO creation | job_schedule_blueprints.draft_data |
| Visit structure | work_order_visits table (not JSONB on work_orders) |
| Lag at scope library line item level | has_lag + lag_days + lag_description per line |
| Maximum lag wins per visit | Yes |
| Gary return visit trigger | 50% of lag elapsed |
| Proximity stored on work_order | proximity_range column |
| Manual scheduling always available | Yes, regardless of Gary state |
| Inspection drag-and-drop confirmation | Always required |
| Hard delete inspections | Never — return to unscheduled |

---

*Spec version: 3.0 — April 2026*
*Built for: Windsurf / Cursor AI-assisted development*
*Owner: Kyle Bindon — Insurance Repair Co, Perth WA*
