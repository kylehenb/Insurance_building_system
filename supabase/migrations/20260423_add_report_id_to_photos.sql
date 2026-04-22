-- Add report_id column to photos table
-- This allows photos to be linked directly to specific reports

ALTER TABLE photos 
ADD COLUMN IF NOT EXISTS report_id UUID REFERENCES reports(id) ON DELETE SET NULL;

-- Add index for faster lookups (only if it doesn't exist)
CREATE INDEX IF NOT EXISTS idx_photos_report_id ON photos(report_id) WHERE report_id IS NOT NULL;
