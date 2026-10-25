-- Follow-ups (tech spec §23.11): "remind me in a week to chase the roofer".
--
-- A follow-up is an action card with a due date: source 'followup', status
-- 'scheduled' until due_at, when the minute cron queues it and the AI drafts
-- the next steps from where the job stands then (a chase email to the trade,
-- a note…), for the office to confirm like any other card. Nothing is sent by
-- itself.
--
-- follow_up: { note, who, thread_id, from_card_id, created_by }

ALTER TABLE action_queue
  ADD COLUMN IF NOT EXISTS due_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS follow_up JSONB;

CREATE INDEX IF NOT EXISTS idx_action_queue_due
  ON action_queue (due_at) WHERE status = 'scheduled';
