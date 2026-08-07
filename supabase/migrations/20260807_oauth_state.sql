-- Short-lived nonce store for QBO OAuth CSRF protection.
-- Rows are one-time use and expire after 10 minutes (enforced in callback route).
-- Service role only — no RLS policies means anon/authenticated roles cannot access this table.

CREATE TABLE IF NOT EXISTS public.oauth_state (
  nonce       TEXT        PRIMARY KEY,
  tenant_id   UUID        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.oauth_state ENABLE ROW LEVEL SECURITY;
