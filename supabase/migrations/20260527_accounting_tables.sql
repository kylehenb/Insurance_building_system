-- accounting_credentials: stores OAuth tokens per tenant per provider
CREATE TABLE IF NOT EXISTS accounting_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  provider TEXT NOT NULL,
  realm_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

ALTER TABLE accounting_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation on accounting_credentials"
  ON accounting_credentials
  FOR ALL
  USING (tenant_id = (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

-- accounting_account_map: maps IRC categories to accounting system accounts per tenant
CREATE TABLE IF NOT EXISTS accounting_account_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  irc_category TEXT NOT NULL,
  accounting_account_id TEXT NOT NULL,
  accounting_account_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, irc_category)
);

ALTER TABLE accounting_account_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation on accounting_account_map"
  ON accounting_account_map
  FOR ALL
  USING (tenant_id = (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));
