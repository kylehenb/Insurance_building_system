-- Add RLS policies for job_schedule_blueprints table

-- Enable RLS
ALTER TABLE job_schedule_blueprints ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view blueprints for their tenant
CREATE POLICY "Users can view blueprints for their tenant"
  ON job_schedule_blueprints FOR SELECT
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Policy: Users can insert blueprints for their tenant
CREATE POLICY "Users can insert blueprints for their tenant"
  ON job_schedule_blueprints FOR INSERT
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Policy: Users can update blueprints for their tenant
CREATE POLICY "Users can update blueprints for their tenant"
  ON job_schedule_blueprints FOR UPDATE
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Policy: Users can delete blueprints for their tenant
CREATE POLICY "Users can delete blueprints for their tenant"
  ON job_schedule_blueprints FOR DELETE
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
