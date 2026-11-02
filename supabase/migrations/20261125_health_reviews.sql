-- Health check, part 3 (tech spec §25.4): an AI-written review of each
-- finished week, month, quarter and year: what worked, what didn't, how busy,
-- systems / AI / limits, and suggested changes. Written once by the nightly
-- /api/health/reviews and kept. Every point cites the numbered facts it was
-- written from, and the facts are kept beside it. Server only (service role).

CREATE TABLE IF NOT EXISTS public.health_reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('week', 'month', 'quarter', 'year')),
  period_from date NOT NULL,
  period_to   date NOT NULL,                 -- the day after the last
  label       text NOT NULL,
  status      text NOT NULL CHECK (status IN ('ready', 'failed')),
  headline    text,
  sections    jsonb NOT NULL DEFAULT '[]',   -- [{ key, title, points: [{ text, facts: [ids] }] }]
  suggestions jsonb NOT NULL DEFAULT '[]',   -- [{ title, why, kind, effort, facts: [ids] }]
  facts       jsonb NOT NULL DEFAULT '[]',   -- [{ id, text }] what the AI was given
  model       text,
  error       text,
  attempts    integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, period_from)
);
ALTER TABLE public.health_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.health_reviews FROM anon, authenticated;
