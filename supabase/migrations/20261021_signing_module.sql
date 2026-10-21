-- In-house e-signing module (tech spec v3.3 §4.30).
--
-- signing_requests  one row per document sent for signature (single signer)
-- signing_events    append-only audit trail for each request
-- signing_rate_limits + signing_rate_limit_hit()  fixed-window rate limiting
--                   for the public (no-login) signing routes
-- storage bucket 'signed-documents'  PRIVATE; service role only
--
-- Writes happen only through server routes using the service role, after the
-- route has checked the signed-in user's tenant (internal routes) or the token
-- hash (public signing routes). Signed-in users get read-only RLS access to
-- their own tenant's rows; there are no insert/update/delete policies.

-- ── signing_requests ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS signing_requests (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id),
  job_id              UUID        NOT NULL REFERENCES jobs(id),
  document_type       TEXT        NOT NULL CHECK (document_type ~ '^[a-z][a-z0-9_]*$'),
    -- key into lib/signing/documents/registry.ts, e.g. 'scope_of_works' | 'building_contract'
  document_title      TEXT        NOT NULL,
  quote_ids           UUID[]      NOT NULL DEFAULT '{}',
  provider            TEXT        NOT NULL DEFAULT 'in_house',
  provider_ref        TEXT,       -- id at a hosted provider, if one is used later
  status              TEXT        NOT NULL DEFAULT 'draft'
                                  CHECK (status IN ('draft', 'sent', 'viewed', 'signed', 'expired', 'revoked')),

  -- SHA-256 (hex) of the signing link token. The raw token is never stored.
  -- Replaced on resend, so the previous link stops working.
  token_hash          TEXT        UNIQUE,

  signer_name         TEXT        NOT NULL,
  signer_email        TEXT,
  signer_phone        TEXT,

  expires_at          TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  viewed_at           TIMESTAMPTZ,
  signed_at           TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  revoked_reason      TEXT,
  last_reminded_at    TIMESTAMPTZ,
  reminder_count      INTEGER     NOT NULL DEFAULT 0,

  -- Documents (bucket 'signed-documents')
  source_pdf_path     TEXT        NOT NULL,
  source_pdf_sha256   TEXT        NOT NULL,
  signed_pdf_path     TEXT,
  signed_pdf_sha256   TEXT,
  signed_job_file_id  UUID        REFERENCES job_files(id),

  -- Snapshot taken when the request is created, so the signer always sees
  -- and signs exactly the document that was generated then.
  fields              JSONB       NOT NULL DEFAULT '[]',  -- located signature fields
  display_content     JSONB       NOT NULL DEFAULT '[]',  -- mobile reading view blocks

  -- Captured at signing
  signature_method    TEXT        CHECK (signature_method IN ('typed', 'drawn')),
  signature_text      TEXT,       -- typed name (typed method)
  signature_style     TEXT,       -- script font key (typed method)
  signer_ip           TEXT,
  signer_user_agent   TEXT,
  signing_locked_at   TIMESTAMPTZ, -- set while a submission is being processed (single use)

  -- Human confirmation of the job stage change after signing
  stage_confirmed_at  TIMESTAMPTZ,
  stage_confirmed_by  UUID        REFERENCES users(id),

  created_by          UUID        REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT signing_requests_signed_complete CHECK (
    status <> 'signed'
    OR (signed_at IS NOT NULL AND signed_pdf_path IS NOT NULL AND signed_pdf_sha256 IS NOT NULL)
  ),
  CONSTRAINT signing_requests_has_contact CHECK (signer_email IS NOT NULL OR signer_phone IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_signing_requests_job
  ON signing_requests (tenant_id, job_id, created_at DESC);

-- Reminder sweep: open requests only
CREATE INDEX IF NOT EXISTS idx_signing_requests_open
  ON signing_requests (tenant_id, sent_at)
  WHERE status IN ('sent', 'viewed');

CREATE OR REPLACE FUNCTION signing_requests_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signing_requests_updated_at ON signing_requests;
CREATE TRIGGER trg_signing_requests_updated_at
  BEFORE UPDATE ON signing_requests
  FOR EACH ROW EXECUTE FUNCTION signing_requests_touch_updated_at();

ALTER TABLE signing_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS signing_requests_tenant_read ON signing_requests;
CREATE POLICY signing_requests_tenant_read ON signing_requests
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT users.tenant_id FROM users WHERE users.id = auth.uid()));

-- ── signing_events (append-only) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS signing_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID        NOT NULL REFERENCES signing_requests(id),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id),
  event       TEXT        NOT NULL,
    -- created | sent | resent | send_failed | viewed | document_opened | signed
    -- | sign_failed | signed_copy_sent | revoked | expired | reminded
    -- | stage_confirmed | rate_limited
  ip          TEXT,
  user_agent  TEXT,
  actor_id    UUID        REFERENCES users(id),  -- office user, null for the signer
  metadata    JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signing_events_request
  ON signing_events (request_id, created_at);

-- Append-only, enforced in the database (applies to the service role too).
CREATE OR REPLACE FUNCTION signing_events_block_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'signing_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_signing_events_append_only ON signing_events;
CREATE TRIGGER trg_signing_events_append_only
  BEFORE UPDATE OR DELETE ON signing_events
  FOR EACH ROW EXECUTE FUNCTION signing_events_block_changes();

ALTER TABLE signing_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS signing_events_tenant_read ON signing_events;
CREATE POLICY signing_events_tenant_read ON signing_events
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT users.tenant_id FROM users WHERE users.id = auth.uid()));

-- ── Rate limiting for public signing routes ─────────────────────────────────

CREATE TABLE IF NOT EXISTS signing_rate_limits (
  bucket_key    TEXT        PRIMARY KEY,  -- e.g. 'ip:<sha256>:submit' or 'token:<hash>:view'
  window_start  TIMESTAMPTZ NOT NULL,
  hits          INTEGER     NOT NULL
);

-- RLS on with no policies: only the service role can touch it.
ALTER TABLE signing_rate_limits ENABLE ROW LEVEL SECURITY;

-- Records one hit and returns true while the key is within p_max hits for the
-- current fixed window of p_window_seconds. Atomic under concurrency.
CREATE OR REPLACE FUNCTION signing_rate_limit_hit(p_key TEXT, p_max INTEGER, p_window_seconds INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_hits INTEGER;
BEGIN
  INSERT INTO signing_rate_limits AS r (bucket_key, window_start, hits)
  VALUES (p_key, now(), 1)
  ON CONFLICT (bucket_key) DO UPDATE SET
    hits = CASE
      WHEN r.window_start < now() - make_interval(secs => p_window_seconds) THEN 1
      ELSE r.hits + 1
    END,
    window_start = CASE
      WHEN r.window_start < now() - make_interval(secs => p_window_seconds) THEN now()
      ELSE r.window_start
    END
  RETURNING hits INTO v_hits;

  RETURN v_hits <= p_max;
END;
$$;

REVOKE ALL ON FUNCTION signing_rate_limit_hit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION signing_rate_limit_hit(TEXT, INTEGER, INTEGER) TO service_role;

-- ── Private storage bucket for source and signed PDFs ───────────────────────
-- No storage.objects policies are created for this bucket, so only the
-- service role can read or write it. Office users download through
-- /api/signing/requests/[id]/document, which checks their tenant first.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('signed-documents', 'signed-documents', false, 26214400, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;
