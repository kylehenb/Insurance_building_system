-- Add estimated_hours_overridden flag to scope_library table
-- This flag indicates whether estimated_hours has been manually overridden
-- When true, the value should not be recalculated automatically
ALTER TABLE scope_library ADD COLUMN IF NOT EXISTS estimated_hours_overridden BOOLEAN DEFAULT false;
COMMENT ON COLUMN scope_library.estimated_hours_overridden IS 'Flag indicating whether estimated_hours has been manually overridden. When true, automatic calculation is disabled.';
