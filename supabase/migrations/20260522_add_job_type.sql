-- Add job_type to distinguish insurance jobs from private/homeowner jobs
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS job_type TEXT NOT NULL DEFAULT 'insurance'
  CHECK (job_type IN ('insurance', 'private'));

COMMENT ON COLUMN jobs.job_type IS 'Type of job: insurance (default) or private (homeowner-direct)';
