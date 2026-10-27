-- Field photos upload as soon as the inspector adds them and are labelled on
-- the server (lib/photos/server-labels.ts), so the phone can be put away.
--
-- client_id: the field app's id for the photo, so a retried upload (after the
--   page reloads or the connection drops) never makes a second copy.
-- ai_status: 'pending' (waiting to be labelled), 'labelling' (claimed by a
--   labelling run — reclaimed if that run dies), 'done', 'failed', or NULL for
--   photos that aren't AI-labelled (desktop uploads, roof photos).
-- ai_*: what the AI made of the photo. ai_label is the AI's final suggestion;
--   comparing it with label once the report is locked gives the corrections
--   the labeller learns from.
-- Until the inspection is submitted these photos have report_id NULL, so they
-- don't show in the report; submit attaches them in report order.

ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS client_id        TEXT,
  ADD COLUMN IF NOT EXISTS ai_status        TEXT,
  ADD COLUMN IF NOT EXISTS ai_claimed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_seen          TEXT,
  ADD COLUMN IF NOT EXISTS ai_kind          TEXT,
  ADD COLUMN IF NOT EXISTS ai_label         TEXT,
  ADD COLUMN IF NOT EXISTS ai_room          TEXT,
  ADD COLUMN IF NOT EXISTS ai_confidence    REAL,
  ADD COLUMN IF NOT EXISTS ai_room_confidence REAL,
  ADD COLUMN IF NOT EXISTS ai_model         TEXT,
  ADD COLUMN IF NOT EXISTS ai_labelled_at   TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_photos_inspection_client
  ON photos(inspection_id, client_id) WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_photos_ai_pending
  ON photos(inspection_id, sequence_number) WHERE ai_status IN ('pending', 'labelling');

-- Corrections lookup: AI-labelled photos per tenant, newest first
CREATE INDEX IF NOT EXISTS idx_photos_ai_labelled
  ON photos(tenant_id, ai_labelled_at DESC) WHERE ai_label IS NOT NULL;

-- Claims up to p_limit photos of one inspection for labelling, in the order
-- the inspector took them. Two uploads finishing together can't both label
-- the same photo. A claim older than 5 minutes is treated as abandoned.
-- Server only (service role): not granted to signed-in users.
CREATE OR REPLACE FUNCTION public.claim_photos_for_labelling(
  p_tenant_id UUID,
  p_inspection_id UUID,
  p_limit INTEGER
)
RETURNS SETOF photos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE photos p
     SET ai_status = 'labelling', ai_claimed_at = now()
   WHERE p.id IN (
     SELECT id FROM photos
      WHERE tenant_id = p_tenant_id
        AND inspection_id = p_inspection_id
        AND (ai_status = 'pending'
             OR (ai_status = 'labelling' AND ai_claimed_at < now() - interval '5 minutes'))
      ORDER BY sequence_number NULLS LAST, uploaded_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING p.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_photos_for_labelling(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_photos_for_labelling(UUID, UUID, INTEGER) TO service_role;
