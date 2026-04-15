-- Job Playbook Fields
--
-- Adds columns to the jobs table required by the Job Playbook workflow steps.
-- These fields track when key contract/compliance documents were sent or obtained,
-- and whether a building permit is required for this job.

-- scope_sent_at: set when the scope of works document is sent to the insured for signature
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS scope_sent_at TIMESTAMPTZ;

-- building_contract_sent_at: set when the building contract is sent to the insured for signature
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS building_contract_sent_at TIMESTAMPTZ;

-- building_permit_required: flag indicating this job requires a council building permit
-- before works can commence (typically triggered by scope value or work type)
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS building_permit_required BOOLEAN NOT NULL DEFAULT false;

-- building_permit_obtained_at: set when the building permit has been granted
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS building_permit_obtained_at TIMESTAMPTZ;

-- No new RLS policies needed — these columns inherit the existing RLS policy on the
-- jobs table which enforces tenant isolation via tenant_id on all SELECT/INSERT/UPDATE/DELETE.

-- Indexes for the timestamp columns (used in playbook completion checks)
CREATE INDEX IF NOT EXISTS idx_jobs_scope_sent_at
  ON jobs (tenant_id, scope_sent_at)
  WHERE scope_sent_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_building_contract_sent_at
  ON jobs (tenant_id, building_contract_sent_at)
  WHERE building_contract_sent_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_building_permit_obtained_at
  ON jobs (tenant_id, building_permit_obtained_at)
  WHERE building_permit_obtained_at IS NOT NULL;
