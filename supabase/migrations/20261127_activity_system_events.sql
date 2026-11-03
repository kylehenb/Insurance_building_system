-- The job ledger (tech spec §23.16): things that happen on a job by
-- themselves — a phase change, an invoice paid in the accounts — go in the
-- who-did-what log beside what people do, with via 'system' and no user, so a
-- job's Comms feed (and the AI) reads its whole history in one place.
ALTER TABLE public.activity_log DROP CONSTRAINT IF EXISTS activity_log_via_check;
ALTER TABLE public.activity_log ADD CONSTRAINT activity_log_via_check CHECK (via IN ('app', 'voice', 'approval', 'system'));
CREATE INDEX IF NOT EXISTS activity_log_job_idx ON public.activity_log (job_id, created_at DESC) WHERE job_id IS NOT NULL;
