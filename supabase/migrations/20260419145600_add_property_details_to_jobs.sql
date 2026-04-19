-- Add property_details JSONB column to jobs table
-- Stores structured physical property attributes captured during first BAR inspection.
-- Lives on jobs (not reports) because property details describe the physical asset,
-- are entered once, and must be shared across all report types on the same job.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS property_details JSONB DEFAULT '{}';

-- Index for future queries filtering by specific property detail values
CREATE INDEX IF NOT EXISTS idx_jobs_property_details
  ON jobs USING GIN (property_details);

-- Comment documents the expected shape for future developers
COMMENT ON COLUMN jobs.property_details IS
  'Structured physical property details captured at first BAR inspection.
   Expected keys: building_age (text), condition (text), roof_type (text),
   wall_type (text), storeys (text), foundation (text), fence (text),
   pool (boolean), detached_garage (boolean), granny_flat (boolean),
   tarp_required (boolean). Extensible — add keys without migration.';
