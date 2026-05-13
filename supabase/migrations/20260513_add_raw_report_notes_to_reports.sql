-- Add raw_report_notes to the reports table.
-- If the old 'notes' column exists, rename it; otherwise add the column fresh.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reports' AND column_name = 'notes'
  ) THEN
    ALTER TABLE reports RENAME COLUMN notes TO raw_report_notes;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reports' AND column_name = 'raw_report_notes'
  ) THEN
    ALTER TABLE reports ADD COLUMN raw_report_notes TEXT;
  END IF;
END $$;
