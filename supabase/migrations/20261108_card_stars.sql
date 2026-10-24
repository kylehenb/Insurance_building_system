-- Stars on action cards (tech spec §23.11), and snooze removed.
--
-- A live action card is the email's star: it needs doing. Its category is
-- the star's symbol — Invoices to pay, Attend and Submit, Everything else —
-- set by the AI and changed with a click. starred_by marks a star the user
-- set or changed themselves: the AI keeps its category, and it stays until
-- they clear it (a reply doesn't close it, and "nothing to do" doesn't drop it).
--
-- Snooze is gone from mail and cards: snoozed cards go back to needing
-- action, and the (never used) mail_snoozes table is dropped.

ALTER TABLE action_queue
  ADD COLUMN IF NOT EXISTS category   TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('invoice', 'attend_submit', 'other')),
  ADD COLUMN IF NOT EXISTS starred_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS starred_at TIMESTAMPTZ;

UPDATE action_queue SET status = 'pending', snoozed_until = NULL, updated_at = now() WHERE status = 'snoozed';

DROP INDEX IF EXISTS idx_action_queue_live_source;
CREATE UNIQUE INDEX idx_action_queue_live_source
  ON action_queue (tenant_id, source, source_ref)
  WHERE source_ref IS NOT NULL AND status IN ('queued', 'generating', 'pending', 'failed');

DROP TABLE IF EXISTS mail_snoozes;
