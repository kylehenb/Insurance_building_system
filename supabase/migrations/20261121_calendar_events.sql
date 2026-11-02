-- The office's calendar, linked to jobs (tech spec §23.13): events on the
-- calendars the office watches (automation_config 'watch_calendar_ids', a
-- comma list of Google calendar ids; the office account must be able to read
-- them) are copied here every few minutes and each is linked to its job — by
-- the job number in it, the inspection it was made for, the address, or the
-- AI reading it beside the job notes. Personal events stay unlinked. Linked
-- appointments drive the KPI "booked" milestone and the check-in after an
-- appointment. Server only (the service role): RLS on, no browser policies.

CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL,
  google_event_id TEXT NOT NULL,
  summary TEXT,
  description TEXT,
  location TEXT,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  all_day BOOLEAN NOT NULL DEFAULT false,
  -- confirmed / tentative / cancelled (Google's)
  status TEXT NOT NULL DEFAULT 'confirmed',
  html_link TEXT,
  -- Google's version of the event: a change means it's linked again
  etag TEXT,
  google_created_at TIMESTAMPTZ,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  -- How it was linked: job_number / inspection / address / ai / manual; none: not a job's (personal, or no match)
  link_source TEXT CHECK (link_source IN ('job_number', 'inspection', 'address', 'ai', 'manual', 'none')),
  link_reason TEXT,
  -- The etag it was last linked at (null: still to link)
  linked_etag TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, calendar_id, google_event_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_job ON calendar_events (job_id, start_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events (tenant_id, start_at);

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

-- Where each watched calendar's sync is up to (Google's sync token)
CREATE TABLE IF NOT EXISTS calendar_sync_state (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL,
  sync_token TEXT,
  synced_at TIMESTAMPTZ,
  sync_error TEXT,
  PRIMARY KEY (tenant_id, calendar_id)
);

ALTER TABLE calendar_sync_state ENABLE ROW LEVEL SECURITY;
