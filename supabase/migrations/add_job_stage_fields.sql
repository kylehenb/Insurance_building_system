-- Job stage fields: homeowner sign-off and completion approval tracking
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS homeowner_signoff_sent_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS homeowner_signoff_received_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS homeowner_signoff_method        TEXT,
  ADD COLUMN IF NOT EXISTS homeowner_signoff_notes         TEXT,
  ADD COLUMN IF NOT EXISTS completion_approved_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completion_approved_method      TEXT,
  ADD COLUMN IF NOT EXISTS completion_approved_notes       TEXT;

-- Inspection no-show tracking
ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS no_show_count    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_no_show_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_show_notes    TEXT;
