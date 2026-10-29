-- The learning module's nightly review (tech spec §24.5): how far each
-- company's feature has been reviewed, and what the last run did.

CREATE TABLE IF NOT EXISTS learning_reviews (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  -- The newest decision reviewed: the next run reads the ones after it
  reviewed_to TIMESTAMPTZ NOT NULL,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  model TEXT,
  usage JSONB,
  -- Counts from the last run: reviewed, added, supported, contradicted, refined, retired
  summary JSONB,
  PRIMARY KEY (tenant_id, feature)
);

-- Server only (the service role): no browser policies
ALTER TABLE learning_reviews ENABLE ROW LEVEL SECURITY;
