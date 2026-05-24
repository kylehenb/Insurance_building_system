-- Minimal playbooks stub required for the playbook_runs FK
CREATE TABLE IF NOT EXISTS playbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE playbooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_playbooks" ON playbooks
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Brain entries — the core knowledge store for the IRC Brain module
CREATE TABLE IF NOT EXISTS brain_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'rule', 'workflow', 'tone', 'classification',
    'example', 'correction', 'entity-definition'
  )),
  persona TEXT CHECK (persona IN ('gary', 'client-comms', 'internal')),
  prompt_keys TEXT[] DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'manual', 'approved-output', 'correction', 'ai-structured', 'promoted-audit'
  )),
  source_ref_table TEXT,
  source_ref_id UUID,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'deprecated')),
  confidence TEXT DEFAULT 'medium' CHECK (confidence IN ('low', 'medium', 'high')),
  times_applied INTEGER DEFAULT 0,
  times_validated INTEGER DEFAULT 0,
  times_contradicted INTEGER DEFAULT 0,
  last_reviewed_at TIMESTAMPTZ,
  review_due_at TIMESTAMPTZ,
  version INTEGER DEFAULT 1,
  previous_content TEXT,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE brain_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_read_brain_entries" ON brain_entries
  FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "tenant_insert_brain_entries" ON brain_entries
  FOR INSERT
  WITH CHECK (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "tenant_update_brain_entries" ON brain_entries
  FOR UPDATE
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Indexes for brain_entries
CREATE INDEX IF NOT EXISTS idx_brain_entries_tenant_status
  ON brain_entries(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_brain_entries_tenant_category
  ON brain_entries(tenant_id, category);

CREATE INDEX IF NOT EXISTS idx_brain_entries_tenant_review_due
  ON brain_entries(tenant_id, review_due_at);

-- GIN index on prompt_keys for efficient array containment queries
-- btree_gin lets us include the scalar tenant_id column in a GIN index
CREATE EXTENSION IF NOT EXISTS btree_gin;

CREATE INDEX IF NOT EXISTS idx_brain_entries_tenant_prompt_keys
  ON brain_entries USING GIN (tenant_id, prompt_keys);

-- Playbook runs — records every execution of an automation playbook
CREATE TABLE IF NOT EXISTS playbook_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  playbook_id UUID NOT NULL REFERENCES playbooks(id),
  job_id UUID REFERENCES jobs(id),
  triggered_by UUID REFERENCES users(id),
  triggered_via TEXT CHECK (triggered_via IN ('assistant', 'action_queue', 'manual')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  field_snapshots JSONB,
  step_log JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE playbook_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_playbook_runs" ON playbook_runs
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Indexes for playbook_runs
CREATE INDEX IF NOT EXISTS idx_playbook_runs_tenant_playbook
  ON playbook_runs(tenant_id, playbook_id);

CREATE INDEX IF NOT EXISTS idx_playbook_runs_tenant_job
  ON playbook_runs(tenant_id, job_id);

CREATE INDEX IF NOT EXISTS idx_playbook_runs_tenant_status
  ON playbook_runs(tenant_id, status);
