-- Auto-confirm (tech spec §24.7): per AI feature and kind (an action card's
-- category), whether its proposals run without a person confirming them.
-- Off until someone turns it on. When a kind has been confirmed untouched
-- (98% of its last 20 decisions) the office is asked whether to turn it on.

CREATE TABLE IF NOT EXISTS learning_auto_confirm (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  kind TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  -- Who last turned it on or off: auto-confirmed cards run as the person who turned it on
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ,
  -- When the office was last asked whether to turn it on, and when they said not now
  suggested_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, feature, kind)
);

CREATE INDEX IF NOT EXISTS idx_learning_auto_confirm_changed_by ON learning_auto_confirm (changed_by);

-- Server only (the service role): no browser policies
ALTER TABLE learning_auto_confirm ENABLE ROW LEVEL SECURITY;
