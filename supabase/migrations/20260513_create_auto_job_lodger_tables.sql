-- Create tables for auto job lodger functionality
-- These tables enable email routing and keyword-based order detection

-- Auto job lodger configuration table
CREATE TABLE IF NOT EXISTS auto_job_lodger_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  notification_enabled BOOLEAN DEFAULT true,
  notification_email TEXT,
  notify_on_success BOOLEAN DEFAULT true,
  notify_on_needs_review BOOLEAN DEFAULT true,
  notify_outside_business_hours BOOLEAN DEFAULT false,
  notification_subject_success TEXT DEFAULT '✅ Order parsed — {claim_number} — {insured_name}',
  notification_subject_review TEXT DEFAULT '⚠️ Order needs review — {original_subject}',
  notification_body_template TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id)
);

-- Client email configuration table for sender pattern matching
CREATE TABLE IF NOT EXISTS client_email_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  sender_patterns JSONB DEFAULT '[]'::jsonb,
  insurer_hint TEXT,
  custom_parsing_notes TEXT,
  default_work_order_type TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Email keyword rules table for subject-based order detection
CREATE TABLE IF NOT EXISTS email_keyword_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Gmail sync state table for polling
CREATE TABLE IF NOT EXISTS gmail_sync_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email_address TEXT NOT NULL,
  last_history_id TEXT,
  last_poll_timestamp TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  polling_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, email_address)
);

-- Enable RLS
ALTER TABLE auto_job_lodger_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_email_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_keyword_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE gmail_sync_state ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "tenant_isolation_auto_job_lodger_config" ON auto_job_lodger_config
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "tenant_isolation_client_email_config" ON client_email_config
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "tenant_isolation_email_keyword_rules" ON email_keyword_rules
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "tenant_isolation_gmail_sync_state" ON gmail_sync_state
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_client_email_config_tenant_client ON client_email_config(tenant_id, client_id);
CREATE INDEX IF NOT EXISTS idx_email_keyword_rules_tenant ON email_keyword_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_gmail_sync_state_tenant_email ON gmail_sync_state(tenant_id, email_address);
