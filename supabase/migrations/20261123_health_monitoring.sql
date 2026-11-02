-- Health monitoring, part 1 (tech spec §25): the records the weekly health
-- check reads, kept as things happen because Vercel and Supabase only hold
-- their own logs for a few days.
--
--   ai_calls      every AI request: which feature, model, tokens, cost, ok/failed
--   cron_runs     every scheduled job run: when, how long, ok/partial/failed
--   system_errors failures the app noticed but carried on past (AI replies it
--                 couldn't read, fallbacks taken because something was down)
--   health_alerts the watcher's open problems, so each is emailed once (and
--                 again daily while it lasts) and closed when it clears
--
-- Only the server writes or reads these (service role); the admin health
-- panel reads them through an API route that checks the permission.

CREATE TABLE IF NOT EXISTS public.ai_calls (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id             uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  feature            text NOT NULL,          -- e.g. 'order-parser', 'action-cards'
  provider           text NOT NULL CHECK (provider IN ('anthropic', 'google', 'openai')),
  model              text NOT NULL,
  input_tokens       integer NOT NULL DEFAULT 0,
  output_tokens      integer NOT NULL DEFAULT 0,
  cache_read_tokens  integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  cost_usd           numeric(12, 6),         -- null when the model has no price set
  duration_ms        integer,
  ok                 boolean NOT NULL DEFAULT true,
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_calls_created_idx ON public.ai_calls (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_calls_tenant_created_idx ON public.ai_calls (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.cron_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route       text NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'partial', 'failed')),
  http_status integer,
  summary     jsonb,
  error       text
);
CREATE INDEX IF NOT EXISTS cron_runs_route_started_idx ON public.cron_runs (route, started_at DESC);
CREATE INDEX IF NOT EXISTS cron_runs_started_idx ON public.cron_runs (started_at);

CREATE TABLE IF NOT EXISTS public.system_errors (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id     uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  source     text NOT NULL,                  -- e.g. 'ai-parse:photo-labels', 'cron:/api/gmail/poll'
  message    text NOT NULL,
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS system_errors_created_idx ON public.system_errors (created_at DESC);
CREATE INDEX IF NOT EXISTS system_errors_source_created_idx ON public.system_errors (source, created_at DESC);

CREATE TABLE IF NOT EXISTS public.health_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text NOT NULL,               -- what it's about, e.g. 'cron-overdue:/api/gmail/poll'
  severity      text NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning', 'critical')),
  title         text NOT NULL,
  detail        text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  notified_at   timestamptz,
  resolved_at   timestamptz,
  occurrences   integer NOT NULL DEFAULT 1
);
-- One open alert per problem
CREATE UNIQUE INDEX IF NOT EXISTS health_alerts_open_key_idx ON public.health_alerts (key) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS health_alerts_first_seen_idx ON public.health_alerts (first_seen_at DESC);

ALTER TABLE public.ai_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_calls FROM anon, authenticated;
REVOKE ALL ON public.cron_runs FROM anon, authenticated;
REVOKE ALL ON public.system_errors FROM anon, authenticated;
REVOKE ALL ON public.health_alerts FROM anon, authenticated;
