-- ============================================================
-- report_versions — snapshot table for report change history
-- One snapshot written per autosave event (debounced ~1.5s)
-- ============================================================

CREATE TABLE IF NOT EXISTS report_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  changed_fields TEXT[],
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE report_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON report_versions;
CREATE POLICY "tenant_isolation" ON report_versions
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_report_versions_report_id ON report_versions(report_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_report_versions_tenant ON report_versions(tenant_id);

-- ============================================================
-- Add soft-delete columns to reports table
-- ============================================================
ALTER TABLE reports ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) DEFAULT NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS delete_reason TEXT DEFAULT NULL;

-- ============================================================
-- Update RLS on reports to exclude soft-deleted from normal queries
-- ============================================================
DROP POLICY IF EXISTS "tenant_isolation" ON reports;

CREATE POLICY "tenant_isolation" ON reports
  USING (
    tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
    AND (
      deleted_at IS NULL
      OR (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
    )
  );
