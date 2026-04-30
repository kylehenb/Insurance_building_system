-- Add scheduled_time column to inspections table
-- This allows scheduling inspections at specific times, not just dates

ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS scheduled_time TIME;

-- Add index for efficient querying by date and time
CREATE INDEX IF NOT EXISTS idx_inpections_scheduled_date_time 
  ON inspections(scheduled_date, scheduled_time)
  WHERE scheduled_date IS NOT NULL;
