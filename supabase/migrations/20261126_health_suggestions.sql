-- Health check, part 4 (tech spec §25.5): the changes the written reviews
-- suggest, one row each, so the owner can accept, dismiss or mark them done.
-- A suggestion raised again by a later review is counted on the same row
-- (one like a dismissed one isn't raised again); accepted and done ones are
-- followed up in later reviews. Each decision is also recorded in the
-- learning module (feature health_suggestion). Server only (service role).

CREATE TABLE IF NOT EXISTS public.health_suggestions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  review_id      uuid REFERENCES public.health_reviews(id) ON DELETE SET NULL,  -- the review that first raised it
  last_review_id uuid REFERENCES public.health_reviews(id) ON DELETE SET NULL,  -- the latest review that raised it
  title          text NOT NULL,
  why            text NOT NULL DEFAULT '',
  kind           text NOT NULL CHECK (kind IN ('automation', 'process', 'wording', 'system')),
  effort         text NOT NULL CHECK (effort IN ('small', 'medium', 'large')),
  evidence       jsonb NOT NULL DEFAULT '[]',   -- the cited facts, [{ id, text }], as the review had them
  times_raised   integer NOT NULL DEFAULT 1,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed', 'done')),
  note           text,                          -- why it was dismissed, or how it was done
  decided_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at     timestamptz,
  done_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS health_suggestions_tenant_status_idx ON public.health_suggestions (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS health_suggestions_review_idx ON public.health_suggestions (review_id);
CREATE INDEX IF NOT EXISTS health_suggestions_last_review_idx ON public.health_suggestions (last_review_id);
ALTER TABLE public.health_suggestions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.health_suggestions FROM anon, authenticated;
