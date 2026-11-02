-- Insurer KPIs, wired up (tech spec §4 clients, §WF-1): each insurer's own
-- contact / booking / visit / report times (clients.kpi_*, edited on the
-- Clients page; new clients start at the defaults 2h / 24h / 2 days / 4 days)
-- set every job's due dates, counted from when the insurer's order arrived.
-- When an insurer's KPIs change, its open jobs' due dates follow
-- (lib/kpi/client-kpis.ts, every minute). Each milestone is recorded on the
-- job when it happens, however it's saved, by the triggers below.

-- When the KPI clock started: the insurer's order arriving
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS kpi_started_at TIMESTAMPTZ;

-- An insurer's KPIs changed (kpi_updated_at) and not yet applied to its jobs (kpi_applied_at)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS kpi_updated_at TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS kpi_applied_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.clients_kpi_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.kpi_contact_hours IS DISTINCT FROM OLD.kpi_contact_hours
     OR NEW.kpi_booking_hours IS DISTINCT FROM OLD.kpi_booking_hours
     OR NEW.kpi_visit_days IS DISTINCT FROM OLD.kpi_visit_days
     OR NEW.kpi_report_days IS DISTINCT FROM OLD.kpi_report_days THEN
    NEW.kpi_updated_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_clients_kpi_touch ON clients;
CREATE TRIGGER trg_clients_kpi_touch BEFORE INSERT OR UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION public.clients_kpi_touch();

-- ── Milestones: the first time each happened, kept once set ──

-- Security definer: a field app or browser save to an inspection, email or
-- report must not fail on the user's rights to the job
CREATE OR REPLACE FUNCTION public.jobs_kpi_mark(p_job UUID, p_milestone TEXT, p_at TIMESTAMPTZ) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_job IS NULL OR p_at IS NULL THEN RETURN; END IF;
  UPDATE jobs SET
    kpi_contacted_at = CASE WHEN p_milestone IN ('contacted', 'booked') THEN COALESCE(kpi_contacted_at, p_at) ELSE kpi_contacted_at END,
    kpi_booked_at    = CASE WHEN p_milestone = 'booked'   THEN COALESCE(kpi_booked_at, p_at)   ELSE kpi_booked_at END,
    kpi_visited_at   = CASE WHEN p_milestone = 'visited'  THEN COALESCE(kpi_visited_at, p_at)  ELSE kpi_visited_at END,
    kpi_reported_at  = CASE WHEN p_milestone = 'reported' THEN COALESCE(kpi_reported_at, p_at) ELSE kpi_reported_at END
  WHERE id = p_job;
END $$;
REVOKE ALL ON FUNCTION public.jobs_kpi_mark(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- Inspections: the booking SMS (contacted), a booking (booked), the safety tick or submit (visited)
CREATE OR REPLACE FUNCTION public.inspections_kpi() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.scheduling_sms_sent_at IS NOT NULL THEN PERFORM jobs_kpi_mark(NEW.job_id, 'contacted', NEW.scheduling_sms_sent_at); END IF;
  IF NEW.booking_confirmed_at IS NOT NULL THEN
    PERFORM jobs_kpi_mark(NEW.job_id, 'booked', NEW.booking_confirmed_at);
  ELSIF NEW.scheduled_date IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.scheduled_date IS NULL) THEN
    PERFORM jobs_kpi_mark(NEW.job_id, 'booked', now());
  END IF;
  IF COALESCE(NEW.safety_confirmed_at, NEW.form_submitted_at) IS NOT NULL THEN
    PERFORM jobs_kpi_mark(NEW.job_id, 'visited', LEAST(NEW.safety_confirmed_at, NEW.form_submitted_at));
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_inspections_kpi ON inspections;
CREATE TRIGGER trg_inspections_kpi AFTER INSERT OR UPDATE ON inspections
  FOR EACH ROW EXECUTE FUNCTION public.inspections_kpi();

-- Communications: a text or email to the insured (contacted)
CREATE OR REPLACE FUNCTION public.communications_kpi() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.direction = 'outbound' AND (NEW.type = 'sms' OR NEW.contact_type = 'insured') THEN
    PERFORM jobs_kpi_mark(NEW.job_id, 'contacted', COALESCE(NEW.created_at, now()));
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_communications_kpi ON communications;
CREATE TRIGGER trg_communications_kpi AFTER INSERT ON communications
  FOR EACH ROW EXECUTE FUNCTION public.communications_kpi();

-- Reports: sent to the insurer (reported)
CREATE OR REPLACE FUNCTION public.reports_kpi() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'sent' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'sent') THEN
    PERFORM jobs_kpi_mark(NEW.job_id, 'reported', now());
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_reports_kpi ON reports;
CREATE TRIGGER trg_reports_kpi AFTER INSERT OR UPDATE OF status ON reports
  FOR EACH ROW EXECUTE FUNCTION public.reports_kpi();

-- ── What's there already ──

-- The clock: when the job's first insurer order arrived, else when the job was made
UPDATE jobs j SET kpi_started_at = COALESCE(
  (SELECT MIN(o.created_at) FROM insurer_orders o WHERE o.job_id = j.id), j.created_at)
WHERE j.kpi_started_at IS NULL AND j.kpi_contact_due IS NOT NULL;

-- Milestones from the records as they stand. A report's send time isn't kept,
-- so it's the first document emailed from the job after the visit
UPDATE jobs j SET
  kpi_contacted_at = COALESCE(j.kpi_contacted_at, LEAST(
    (SELECT MIN(i.scheduling_sms_sent_at) FROM inspections i WHERE i.job_id = j.id),
    (SELECT MIN(c.created_at) FROM communications c WHERE c.job_id = j.id AND c.direction = 'outbound' AND (c.type = 'sms' OR c.contact_type = 'insured')),
    (SELECT MIN(i.booking_confirmed_at) FROM inspections i WHERE i.job_id = j.id))),
  kpi_booked_at = COALESCE(j.kpi_booked_at, (SELECT MIN(i.booking_confirmed_at) FROM inspections i WHERE i.job_id = j.id)),
  kpi_visited_at = COALESCE(j.kpi_visited_at, (SELECT MIN(LEAST(i.safety_confirmed_at, i.form_submitted_at)) FROM inspections i WHERE i.job_id = j.id))
WHERE j.kpi_contact_due IS NOT NULL;

UPDATE jobs j SET kpi_reported_at = (
  SELECT MIN(c.created_at) FROM communications c
  WHERE c.job_id = j.id AND c.direction = 'outbound' AND c.source = 'document_send'
    AND (j.kpi_visited_at IS NULL OR c.created_at >= j.kpi_visited_at))
WHERE j.kpi_contact_due IS NOT NULL AND j.kpi_reported_at IS NULL
  AND EXISTS (SELECT 1 FROM reports r WHERE r.job_id = j.id AND r.status = 'sent' AND r.deleted_at IS NULL);

-- Every insurer's KPIs re-applied once: due dates from the order arriving and each insurer's own times
UPDATE clients SET kpi_updated_at = now();
