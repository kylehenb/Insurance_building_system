-- Add missing pricing fields to clients table
-- These fields allow per-insurer pricing for leak detection and make safe reports

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS leak_detection_report_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS make_safe_amount NUMERIC;

-- Add comments for documentation
COMMENT ON COLUMN clients.leak_detection_report_amount IS 'Leak detection report fee for this insurer';
COMMENT ON COLUMN clients.make_safe_amount IS 'Make safe report fee for this insurer';
