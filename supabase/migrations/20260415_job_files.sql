-- Job Files table
CREATE TABLE job_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  description TEXT,                     -- Auto-generated or manual, can be blank
  file_name TEXT NOT NULL,              -- Actual file name
  file_kind TEXT NOT NULL,              -- File type: PDF, JPEG, etc.
  storage_path TEXT NOT NULL,           -- Supabase storage path
  mime_type TEXT NOT NULL,              -- MIME type for validation
  size_bytes INTEGER NOT NULL,          -- File size
  added_by UUID REFERENCES users(id),   -- User who uploaded, null if system-generated
  is_system_generated BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE job_files ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policy
CREATE POLICY "tenant_isolation" ON job_files
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Allow read for tenant users
CREATE POLICY "users_can_read_job_files" ON job_files
  FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Allow insert for tenant users
CREATE POLICY "users_can_insert_job_files" ON job_files
  FOR INSERT
  WITH CHECK (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Allow update for tenant users (description only)
CREATE POLICY "users_can_update_job_files" ON job_files
  FOR UPDATE
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Allow delete for tenant users
CREATE POLICY "users_can_delete_job_files" ON job_files
  FOR DELETE
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Indexes
CREATE INDEX idx_job_files_job ON job_files(job_id);
CREATE INDEX idx_job_files_tenant ON job_files(tenant_id);
CREATE INDEX idx_job_files_created ON job_files(created_at DESC);
