-- Rename inspections.notes to inspections.raw_report_notes
-- This aligns the field app with the web app BAR report naming convention

-- Rename the column
ALTER TABLE inspections
  RENAME COLUMN notes TO raw_report_notes;

-- Add comment to document the field
COMMENT ON COLUMN inspections.raw_report_notes IS 'Raw report notes from field app - mirror of reports.raw_report_notes. Used as input for AI report generation.';
