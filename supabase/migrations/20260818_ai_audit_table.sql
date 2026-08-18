-- ai_audit: append-only log of every AI API call in the pipeline.
-- One row per Gemini / Claude invocation. Never deleted. Admin-readable only.
-- Part of the AI Activity Dashboard spec (Section 4.28 of tech spec v3.3).
--
-- ai_audit_id on insurer_orders links each auto-parsed order back to the Gemini
-- call that produced it, including calls that were rejected at the is_new_order gate
-- (those rows are written to ai_audit with outcome = 'rejected' but no insurer_orders row).

CREATE TABLE IF NOT EXISTS ai_audit (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id),
  job_id            UUID        REFERENCES jobs(id),
  prompt_key        TEXT        NOT NULL,
  model             TEXT        NOT NULL,
  category          TEXT        NOT NULL,
    -- 'report' | 'scope' | 'photo' | 'comms' | 'scheduling' | 'parsing' | 'action_queue'
  input_summary     TEXT,
  input_context     JSONB,
  output_raw        TEXT,
  output_parsed     JSONB,
  confidence        TEXT,       -- 'high' | 'medium' | 'low' | null
  confidence_reason TEXT,
  was_edited        BOOLEAN     NOT NULL DEFAULT false,
  edit_delta        JSONB,
  edited_by         UUID        REFERENCES users(id),
  edited_at         TIMESTAMPTZ,
  outcome           TEXT        NOT NULL DEFAULT 'pending',
    -- 'pending' | 'accepted' | 'edited' | 'rejected'
  tokens_used       INTEGER,
  latency_ms        INTEGER,
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No delete policy — append-only enforced at the application layer.

CREATE INDEX IF NOT EXISTS idx_ai_audit_tenant_created
  ON ai_audit (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_audit_prompt_key
  ON ai_audit (tenant_id, prompt_key, created_at DESC);

-- Link the Gemini parsing call that produced each auto-parsed order.
-- Null for manual_entry rows and for orders created before this column was added.
ALTER TABLE insurer_orders
  ADD COLUMN IF NOT EXISTS ai_audit_id UUID REFERENCES ai_audit(id);

CREATE INDEX IF NOT EXISTS idx_insurer_orders_ai_audit_id
  ON insurer_orders (ai_audit_id)
  WHERE ai_audit_id IS NOT NULL;
