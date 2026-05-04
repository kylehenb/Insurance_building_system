-- Add additional_notes column to reports table
-- This field allows adding supplementary notes to BAR reports

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS additional_notes TEXT;
