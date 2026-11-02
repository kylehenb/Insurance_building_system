-- Job phases (tech spec §5b "Job phases"): five phases the office thinks in —
-- assessment → awaiting_decision → in_repair → invoicing → closed — and the
-- next step inside each, worked out from the job's records
-- (lib/jobs/phase.ts). They replace the 17 stages, which went stale because
-- they were only worked out on a few events. Any change to what a phase is
-- worked out from flags the job (phase_stale) — whichever way it's saved —
-- and the every-minute cron works it out again.
--
-- The safety net for insurers who never decide: a job awaiting a decision
-- for longer than its insurer's clients.decision_lapse_days (default 180)
-- with every invoice paid closes as "no decision" (lapsed_at); an approval
-- that comes later reopens it.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS phase TEXT
  CHECK (phase IN ('assessment', 'awaiting_decision', 'in_repair', 'invoicing', 'closed'));
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS phase_step TEXT;
-- Why a closed job closed: complete / declined / cancelled / no_decision
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS closed_reason TEXT
  CHECK (closed_reason IN ('complete', 'declined', 'cancelled', 'no_decision'));
-- When the job came into its phase (the lapse clock for awaiting_decision)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS phase_since TIMESTAMPTZ;
-- Closed as "no decision" by the safety net (cleared by an approval)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lapsed_at TIMESTAMPTZ;
-- Closed by hand, with its reason (the old-jobs clean-up, or the office)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS closed_by_hand TEXT
  CHECK (closed_by_hand IN ('complete', 'declined', 'cancelled', 'no_decision'));
-- Something it's worked out from changed: work it out again
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS phase_stale BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_jobs_phase ON jobs (tenant_id, phase);
CREATE INDEX IF NOT EXISTS idx_jobs_phase_stale ON jobs (phase_stale) WHERE phase_stale;

-- Each insurer's lapse time, beside its KPIs on the Clients page
ALTER TABLE clients ADD COLUMN IF NOT EXISTS decision_lapse_days INTEGER DEFAULT 180;

-- ── Flagging a job to be worked out again ──

CREATE OR REPLACE FUNCTION public.mark_job_phase_stale() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  j UUID := COALESCE(NEW.job_id, OLD.job_id);
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.job_id IS DISTINCT FROM NEW.job_id AND OLD.job_id IS NOT NULL THEN
    UPDATE jobs SET phase_stale = true WHERE id = OLD.job_id;
  END IF;
  IF j IS NOT NULL THEN UPDATE jobs SET phase_stale = true WHERE id = j AND NOT phase_stale; END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_quotes_phase ON quotes;
CREATE TRIGGER trg_quotes_phase AFTER INSERT OR UPDATE OR DELETE ON quotes FOR EACH ROW EXECUTE FUNCTION public.mark_job_phase_stale();
DROP TRIGGER IF EXISTS trg_reports_phase ON reports;
CREATE TRIGGER trg_reports_phase AFTER INSERT OR UPDATE OF status, deleted_at, job_id OR DELETE ON reports FOR EACH ROW EXECUTE FUNCTION public.mark_job_phase_stale();
DROP TRIGGER IF EXISTS trg_inspections_phase ON inspections;
CREATE TRIGGER trg_inspections_phase AFTER INSERT OR UPDATE OR DELETE ON inspections FOR EACH ROW EXECUTE FUNCTION public.mark_job_phase_stale();
DROP TRIGGER IF EXISTS trg_invoices_phase ON invoices;
CREATE TRIGGER trg_invoices_phase AFTER INSERT OR UPDATE OF status, invoice_type, direction, job_id OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION public.mark_job_phase_stale();
DROP TRIGGER IF EXISTS trg_work_order_visits_phase ON work_order_visits;
CREATE TRIGGER trg_work_order_visits_phase AFTER INSERT OR UPDATE OF status, job_id OR DELETE ON work_order_visits FOR EACH ROW EXECUTE FUNCTION public.mark_job_phase_stale();

-- The job's own fields a phase is worked out from
CREATE OR REPLACE FUNCTION public.jobs_phase_fields_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.override_stage IS DISTINCT FROM OLD.override_stage
     OR NEW.homeowner_signoff_sent_at IS DISTINCT FROM OLD.homeowner_signoff_sent_at
     OR NEW.homeowner_signoff_received_at IS DISTINCT FROM OLD.homeowner_signoff_received_at
     OR NEW.completion_approved_at IS DISTINCT FROM OLD.completion_approved_at
     OR NEW.lapsed_at IS DISTINCT FROM OLD.lapsed_at
     OR NEW.closed_by_hand IS DISTINCT FROM OLD.closed_by_hand THEN
    NEW.phase_stale := true;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_jobs_phase_fields ON jobs;
CREATE TRIGGER trg_jobs_phase_fields BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION public.jobs_phase_fields_changed();

-- Every job worked out afresh once
UPDATE jobs SET phase_stale = true;
