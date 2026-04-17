-- Work Orders v3.0 - Add scheduling tables and update work_orders

-- 1. Create job_schedule_blueprints table first (needed for foreign key)
CREATE TABLE IF NOT EXISTS job_schedule_blueprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  status TEXT DEFAULT 'draft',
  draft_data JSONB,
  confirmed_by UUID REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create work_order_visits table
CREATE TABLE IF NOT EXISTS work_order_visits (
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
  lag_days_after INTEGER DEFAULT 0,
  lag_description TEXT,
  gary_triggered_at TIMESTAMPTZ,
  gary_return_trigger_at TIMESTAMPTZ,
  trade_confirmed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Update work_orders table to v3.0 spec (after tables are created)
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS blueprint_id UUID REFERENCES job_schedule_blueprints(id),
  ADD COLUMN IF NOT EXISTS sequence_order INTEGER,
  ADD COLUMN IF NOT EXISTS is_concurrent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS predecessor_work_order_id UUID REFERENCES work_orders(id),
  ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC,
  ADD COLUMN IF NOT EXISTS total_visits INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS current_visit INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS proximity_range TEXT DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS gary_state TEXT DEFAULT 'not_started';

-- Note: scheduled_date column will be deprecated but kept for backward compatibility
-- New scheduling lives in work_order_visits table

-- 4. Create trade_type_sequence table
CREATE TABLE IF NOT EXISTS trade_type_sequence (
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

-- 5. Seed trade_type_sequence with IRC defaults
INSERT INTO trade_type_sequence (tenant_id, trade_type, typical_sequence_order, typical_visit_count, notes)
SELECT 
  id,
  'electrician',
  10,
  2,
  'Disconnect first visit; reconnect last visit'
FROM tenants
ON CONFLICT (tenant_id, trade_type) DO NOTHING;

INSERT INTO trade_type_sequence (tenant_id, trade_type, typical_sequence_order, typical_visit_count, notes)
SELECT 
  id,
  'plumber',
  15,
  2,
  'Disconnect first visit; reconnect last visit'
FROM tenants
ON CONFLICT (tenant_id, trade_type) DO NOTHING;

INSERT INTO trade_type_sequence (tenant_id, trade_type, typical_sequence_order, typical_visit_count, notes)
SELECT 
  id,
  'demolition',
  20,
  1,
  NULL
FROM tenants
ON CONFLICT (tenant_id, trade_type) DO NOTHING;

INSERT INTO trade_type_sequence (tenant_id, trade_type, typical_sequence_order, typical_visit_count, notes)
SELECT 
  id,
  'plasterer',
  30,
  2,
  'Strip visit + reinstate visit; lag between'
FROM tenants
ON CONFLICT (tenant_id, trade_type) DO NOTHING;

INSERT INTO trade_type_sequence (tenant_id, trade_type, typical_sequence_order, typical_visit_count, notes)
SELECT 
  id,
  'carpenter',
  40,
  1,
  NULL
FROM tenants
ON CONFLICT (tenant_id, trade_type) DO NOTHING;

INSERT INTO trade_type_sequence (tenant_id, trade_type, typical_sequence_order, typical_visit_count, notes)
SELECT 
  id,
  'tiler',
  50,
  1,
  NULL
FROM tenants
ON CONFLICT (tenant_id, trade_type) DO NOTHING;

INSERT INTO trade_type_sequence (tenant_id, trade_type, typical_sequence_order, typical_visit_count, notes)
SELECT 
  id,
  'painter',
  60,
  1,
  'Follows plasterer; check lag complete'
FROM tenants
ON CONFLICT (tenant_id, trade_type) DO NOTHING;

INSERT INTO trade_type_sequence (tenant_id, trade_type, typical_sequence_order, typical_visit_count, notes)
SELECT 
  id,
  'roofer',
  25,
  1,
  'Often independent; can run concurrent'
FROM tenants
ON CONFLICT (tenant_id, trade_type) DO NOTHING;

-- 6. Add RLS policies
ALTER TABLE work_order_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_work_order_visits" ON work_order_visits
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

ALTER TABLE job_schedule_blueprints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_job_schedule_blueprints" ON job_schedule_blueprints
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

ALTER TABLE trade_type_sequence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_trade_type_sequence" ON trade_type_sequence
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- 7. Add indexes for v3.0
CREATE INDEX IF NOT EXISTS idx_work_order_visits_work_order ON work_order_visits(work_order_id);
CREATE INDEX IF NOT EXISTS idx_work_order_visits_job ON work_order_visits(job_id);
CREATE INDEX IF NOT EXISTS idx_work_order_visits_scheduled ON work_order_visits(tenant_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_work_order_visits_gary_trigger ON work_order_visits(gary_return_trigger_at) WHERE gary_return_trigger_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_blueprints_job ON job_schedule_blueprints(job_id);
