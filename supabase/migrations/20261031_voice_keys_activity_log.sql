-- Per-person voice connector keys and the who-did-what log. Additive only.
--
-- voice_keys: each person makes their own key for the Claude voice connector
-- (Settings → Voice connector), so the connector acts as them, with their
-- permissions. Only a SHA-256 hash of the key is stored; the key itself is
-- shown once. Revoked keys stop working straight away.
--
-- activity_log: what was done (sent, lodged, changed, approved…), by whom,
-- how (app, voice, or run on approval) and on which job.
--
-- Users read their tenant's rows; all writes go through the server (service role).

CREATE TABLE IF NOT EXISTS public.voice_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  label        text NOT NULL,
  key_hash     text NOT NULL UNIQUE,            -- sha256 hex of the key
  key_hint     text NOT NULL,                   -- last 4 characters, to tell keys apart
  created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  revoked_by   uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.activity_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES public.users(id) ON DELETE SET NULL,   -- who it was done as
  action       text NOT NULL,                   -- permission key, or approval.*
  summary      text NOT NULL,
  job_id       uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  via          text NOT NULL DEFAULT 'app' CHECK (via IN ('app', 'voice', 'approval')),
  outcome      text NOT NULL DEFAULT 'done' CHECK (outcome IN ('done', 'failed', 'requested', 'rejected', 'cancelled')),
  detail       text,                            -- what happened, or why it failed
  voice_key_id uuid REFERENCES public.voice_keys(id) ON DELETE SET NULL,
  approval_id  uuid REFERENCES public.approval_requests(id) ON DELETE SET NULL,
  approved_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.voice_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_keys FROM anon, authenticated;
REVOKE ALL ON public.activity_log FROM anon, authenticated;

-- Keys: people see their own (the hash is useless without the key anyway)
DROP POLICY IF EXISTS voice_keys_own_read ON public.voice_keys;
CREATE POLICY voice_keys_own_read ON public.voice_keys
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS activity_log_tenant_read ON public.activity_log;
CREATE POLICY activity_log_tenant_read ON public.activity_log
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT users.tenant_id FROM public.users WHERE users.id = (SELECT auth.uid())));

GRANT SELECT ON public.voice_keys TO authenticated;
GRANT SELECT ON public.activity_log TO authenticated;
GRANT ALL ON public.voice_keys TO service_role;
GRANT ALL ON public.activity_log TO service_role;

CREATE INDEX IF NOT EXISTS idx_voice_keys_tenant_user ON public.voice_keys (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_voice_keys_created_by ON public.voice_keys (created_by);
CREATE INDEX IF NOT EXISTS idx_voice_keys_revoked_by ON public.voice_keys (revoked_by);
CREATE INDEX IF NOT EXISTS idx_activity_log_tenant_created ON public.activity_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON public.activity_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_job ON public.activity_log (job_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_voice_key ON public.activity_log (voice_key_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_approval ON public.activity_log (approval_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_approved_by ON public.activity_log (approved_by);
