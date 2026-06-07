-- Report templates for AI report generation assistance.
-- All statements are idempotent — table and columns may already exist.

CREATE TABLE IF NOT EXISTS report_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  report_type TEXT NOT NULL,
  loss_types TEXT[],
  use_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE report_templates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'report_templates' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY "tenant_isolation" ON report_templates
      USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_report_templates_tenant
  ON report_templates(tenant_id);

CREATE INDEX IF NOT EXISTS idx_report_templates_use_count
  ON report_templates(tenant_id, use_count DESC);

-- Damage scenario columns on reports (idempotent)
ALTER TABLE reports ADD COLUMN IF NOT EXISTS damage_template TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS damage_template_saved BOOLEAN DEFAULT true;
