ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS submission_status TEXT,
  ADD COLUMN IF NOT EXISTS submission_error  TEXT;
