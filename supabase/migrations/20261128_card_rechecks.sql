-- Out-of-date action cards (tech spec §23.17, lib/actions/recheck.ts).
--
-- A card is written from the job as it stood then. When something lands in
-- the job's Comms feed afterwards (an email, a note, documents sent, a stage
-- change…), the database marks the job here, whichever way it was saved. The
-- minute cron waits until the job has gone quiet and nobody has it open
-- (job_presence), then checks the job's open cards: free rules first, and the
-- AI only when the change could have done or changed what a card asks.

-- When the card last saw the job: set when it's made and when it's checked
ALTER TABLE action_queue ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ;
UPDATE action_queue SET checked_at = updated_at WHERE checked_at IS NULL;
ALTER TABLE action_queue ALTER COLUMN checked_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_action_queue_job_open ON action_queue (job_id)
  WHERE status IN ('pending', 'failed');

-- Jobs that changed since their open cards were written (server only)
CREATE TABLE IF NOT EXISTS job_card_rechecks (
  job_id UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  first_change_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_change_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changes INTEGER NOT NULL DEFAULT 1
);
ALTER TABLE job_card_rechecks ENABLE ROW LEVEL SECURITY;

-- Who has a job open right now: the job page says so every minute while it's
-- on screen (POST /api/jobs/[jobId]/presence). Server only.
CREATE TABLE IF NOT EXISTS job_presence (
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, user_id)
);
ALTER TABLE job_presence ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.mark_job_cards_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.job_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.job_id IS NOT DISTINCT FROM NEW.job_id THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'activity_log' THEN
    -- The cards' own confirm/skip, actions whose record is a feed row
    -- already (the email, the note), and things that didn't happen
    IF NEW.action IN ('actions.review', 'mail.send', 'send.replies', 'jobs.notes', 'approval.decide')
      OR NEW.outcome <> 'done' THEN RETURN NEW; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM action_queue WHERE job_id = NEW.job_id AND status IN ('pending', 'failed')) THEN
    RETURN NEW;
  END IF;
  INSERT INTO job_card_rechecks (job_id, tenant_id) VALUES (NEW.job_id, NEW.tenant_id)
  ON CONFLICT (job_id) DO UPDATE SET last_change_at = now(), changes = job_card_rechecks.changes + 1;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_activity_cards_changed ON activity_log;
CREATE TRIGGER trg_activity_cards_changed AFTER INSERT ON activity_log
  FOR EACH ROW EXECUTE FUNCTION public.mark_job_cards_changed();

-- An email filed onto a job later counts as landing in its feed then
DROP TRIGGER IF EXISTS trg_communications_cards_changed ON communications;
CREATE TRIGGER trg_communications_cards_changed AFTER INSERT OR UPDATE OF job_id ON communications
  FOR EACH ROW EXECUTE FUNCTION public.mark_job_cards_changed();
