-- Automatic similar-report lookup for AI report writing.
--
-- Every locked report gets a semantic "fingerprint" (an OpenAI text-embedding-3-small
-- vector, 512 dims). When a new report is generated, the inspector's notes are
-- fingerprinted the same way and the closest locked reports of the same type are
-- handed to the AI as style/detail references. Replaces the manual damage-template
-- picker (report_templates / reports.damage_template are left in place, unused).
--
-- Fingerprints are written by lib/reports/similar-reports.ts, either straight after a
-- report is locked or by the /api/reports/index-embeddings cron (which also backfills).
-- All statements are idempotent.

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

ALTER TABLE reports ADD COLUMN IF NOT EXISTS embedding extensions.vector(512);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;

-- Lookups always filter by tenant + report type over locked, fingerprinted reports.
-- An exact scan over that subset is a few milliseconds even at tens of thousands of
-- reports, so no approximate (HNSW) vector index is needed yet.
CREATE INDEX IF NOT EXISTS idx_reports_similarity_lookup
  ON reports (tenant_id, report_type)
  WHERE is_locked = true AND embedding IS NOT NULL AND deleted_at IS NULL;

-- Pending-work index for the indexing cron.
CREATE INDEX IF NOT EXISTS idx_reports_embedding_pending
  ON reports (created_at DESC)
  WHERE is_locked = true AND embedding IS NULL AND deleted_at IS NULL;

-- Drop a fingerprint as soon as it can be stale: the report is unlocked or deleted, or
-- its written content changes. Re-locking re-fingerprints it from the current content.
CREATE OR REPLACE FUNCTION reports_clear_stale_embedding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.embedding IS NOT NULL
     AND NEW.embedded_at IS NOT DISTINCT FROM OLD.embedded_at
     AND (
       NEW.is_locked IS DISTINCT FROM true
       OR NEW.deleted_at IS NOT NULL
       OR NEW.report_type             IS DISTINCT FROM OLD.report_type
       OR NEW.loss_type               IS DISTINCT FROM OLD.loss_type
       OR NEW.raw_report_notes        IS DISTINCT FROM OLD.raw_report_notes
       OR NEW.incident_description    IS DISTINCT FROM OLD.incident_description
       OR NEW.cause_of_damage         IS DISTINCT FROM OLD.cause_of_damage
       OR NEW.how_damage_occurred     IS DISTINCT FROM OLD.how_damage_occurred
       OR NEW.resulting_damage        IS DISTINCT FROM OLD.resulting_damage
       OR NEW.pre_existing_conditions IS DISTINCT FROM OLD.pre_existing_conditions
       OR NEW.maintenance_notes       IS DISTINCT FROM OLD.maintenance_notes
       OR NEW.conclusion              IS DISTINCT FROM OLD.conclusion
       OR NEW.type_specific_fields    IS DISTINCT FROM OLD.type_specific_fields
     )
  THEN
    NEW.embedding := NULL;
    NEW.embedded_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reports_clear_stale_embedding ON reports;
CREATE TRIGGER trg_reports_clear_stale_embedding
  BEFORE UPDATE ON reports
  FOR EACH ROW
  EXECUTE FUNCTION reports_clear_stale_embedding();

-- Closest locked reports to a query fingerprint. Ranked by similarity, with a small
-- penalty for age (0.02 per year, capped at 3 years) so newer reports win near-ties,
-- and a small boost when the job's insurer matches.
CREATE OR REPLACE FUNCTION match_similar_reports(
  p_tenant_id UUID,
  p_report_type TEXT,
  p_query_embedding extensions.vector(512),
  p_insurer TEXT DEFAULT NULL,
  p_exclude_report_id UUID DEFAULT NULL,
  p_match_count INT DEFAULT 3,
  p_min_similarity DOUBLE PRECISION DEFAULT 0.3
)
RETURNS TABLE (id UUID, similarity DOUBLE PRECISION, score DOUBLE PRECISION)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  WITH candidates AS (
    SELECT
      r.id,
      r.created_at,
      j.insurer,
      1 - (r.embedding <=> p_query_embedding) AS similarity
    FROM reports r
    LEFT JOIN jobs j ON j.id = r.job_id
    WHERE r.tenant_id = p_tenant_id
      AND r.report_type = p_report_type
      AND r.is_locked = true
      AND r.deleted_at IS NULL
      AND r.embedding IS NOT NULL
      AND (p_exclude_report_id IS NULL OR r.id <> p_exclude_report_id)
  )
  SELECT
    c.id,
    c.similarity,
    c.similarity
      - LEAST(EXTRACT(EPOCH FROM (now() - COALESCE(c.created_at, now()))) / 31557600.0, 3) * 0.02
      + CASE
          WHEN p_insurer IS NOT NULL AND c.insurer IS NOT NULL
               AND lower(trim(c.insurer)) = lower(trim(p_insurer))
          THEN 0.03 ELSE 0
        END AS score
  FROM candidates c
  WHERE c.similarity >= p_min_similarity
  ORDER BY score DESC
  LIMIT p_match_count;
$$;

-- Server-side only (called with the service role); takes a tenant id as an argument.
REVOKE EXECUTE ON FUNCTION match_similar_reports(UUID, TEXT, extensions.vector, TEXT, UUID, INT, DOUBLE PRECISION)
  FROM PUBLIC, anon, authenticated;
