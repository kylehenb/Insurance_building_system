-- Done for you (tech spec §23.19): things IRC did by itself from the office's
-- own words — e.g. a trade's day put on the schedule because the office's
-- email said "the painter is going Tuesday" (or agreed to a day proposed).
-- Each keeps what it changed and what was there before, so it can be undone
-- with one tap. Server only (the service role): RLS on, no browser policies.

CREATE TABLE IF NOT EXISTS auto_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  -- trade_visit: a work order visit booked or moved
  kind TEXT NOT NULL CHECK (kind IN ('trade_visit')),
  summary TEXT NOT NULL,
  -- Where the words came from: sent_email (source_ref = Gmail message id)
  source TEXT NOT NULL CHECK (source IN ('sent_email')),
  source_ref TEXT,
  -- The words it went on, quoted
  evidence TEXT,
  -- What was changed: { work_order_id, visit_number }
  target JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- The visit's day(s) before and after: { start_date, end_date, start_time } (before null: it had none)
  before JSONB,
  after JSONB,
  status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('done', 'undone')),
  undone_at TIMESTAMPTZ,
  undone_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One per email and work order (a retried read doesn't book twice)
CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_actions_source ON auto_actions (tenant_id, source, source_ref, (target->>'work_order_id'));
CREATE INDEX IF NOT EXISTS idx_auto_actions_recent ON auto_actions (tenant_id, created_at DESC);

ALTER TABLE auto_actions ENABLE ROW LEVEL SECURITY;
