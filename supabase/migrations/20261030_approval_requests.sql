-- Approval queue (lib/approvals). Additive only.
--
-- When a user's level for an action is "needs approval" (lib/permissions),
-- the action is saved here instead of being done: what to run (operation +
-- payload), a plain-English summary, who asked and how. Someone allowed to
-- do the action approves it (which runs it) or rejects it; the requester can
-- cancel it. Users read their tenant's rows; all writes go through the
-- server (service role).

CREATE TABLE IF NOT EXISTS public.approval_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  action        text NOT NULL,                 -- permission key, e.g. send.documents
  operation     text NOT NULL,                 -- what approving runs (lib/approvals/operations.ts)
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary       text NOT NULL,
  job_id        uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  requested_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  requested_via text NOT NULL DEFAULT 'app' CHECK (requested_via IN ('app', 'voice')),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'failed', 'cancelled')),
  decided_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  decision_note text,
  result        text,                          -- what running it did, or why it failed
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.approval_requests FROM anon, authenticated;

DROP POLICY IF EXISTS approval_requests_tenant_read ON public.approval_requests;
CREATE POLICY approval_requests_tenant_read ON public.approval_requests
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT users.tenant_id FROM public.users WHERE users.id = (SELECT auth.uid())));

GRANT SELECT ON public.approval_requests TO authenticated;
GRANT ALL ON public.approval_requests TO service_role;

CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant_status ON public.approval_requests (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_requests_job ON public.approval_requests (job_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_requested_by ON public.approval_requests (requested_by);
CREATE INDEX IF NOT EXISTS idx_approval_requests_decided_by ON public.approval_requests (decided_by);
