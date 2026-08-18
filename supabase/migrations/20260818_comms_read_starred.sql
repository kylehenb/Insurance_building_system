-- Read tracking: single timestamp, null = unread. Set on first row expand.
-- Not per-user in this pass — single timestamp on the row is sufficient for
-- the single-tenant / single-operator use case. A per-user join table can be
-- added later if multi-user "who read what" becomes a requirement.
ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ NULL;

-- Manual star/flag, independent of read state.
ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS is_starred BOOLEAN NOT NULL DEFAULT false;

-- Sparse index: only starred rows, keeps index small.
CREATE INDEX IF NOT EXISTS idx_communications_is_starred
  ON communications (tenant_id, is_starred)
  WHERE is_starred = true;
