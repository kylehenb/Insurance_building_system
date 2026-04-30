-- Add start_time, finish_time, and duration to inspections table
-- scheduled_time will be renamed to start_time for clarity

-- Rename scheduled_time to start_time
ALTER TABLE inspections 
  RENAME COLUMN scheduled_time TO start_time;

-- Add finish_time column
ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS finish_time TIME;

-- Add duration_minutes column
ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 60;

-- Update index to use start_time instead of scheduled_time
DROP INDEX IF EXISTS idx_inpections_scheduled_date_time;
CREATE INDEX idx_inspections_scheduled_date_time 
  ON inspections(scheduled_date, start_time)
  WHERE scheduled_date IS NOT NULL;

-- Migrate existing data: if start_time exists but duration doesn't, set default 60 minutes
-- If start_time exists, calculate finish_time based on duration
DO $$
BEGIN
  -- Set default duration for existing records
  UPDATE inspections 
  SET duration_minutes = 60 
  WHERE duration_minutes IS NULL AND start_time IS NOT NULL;
  
  -- Calculate finish_time for existing records
  UPDATE inspections 
  SET finish_time = (start_time::interval + (duration_minutes || ' minutes')::interval)::time
  WHERE finish_time IS NULL AND start_time IS NOT NULL AND duration_minutes IS NOT NULL;
END $$;
