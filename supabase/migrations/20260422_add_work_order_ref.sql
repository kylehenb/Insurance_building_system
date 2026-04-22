-- Add work_order_ref field to work_orders table
-- This will store references like "WO-IRC1001-001" similar to invoice references

ALTER TABLE work_orders
ADD COLUMN work_order_ref TEXT;

-- Add index for faster lookups
CREATE INDEX idx_work_orders_work_order_ref ON work_orders(work_order_ref);

-- Add unique constraint per tenant for work_order_ref
-- This ensures references are unique within each tenant
CREATE UNIQUE INDEX idx_work_orders_tenant_ref_unique 
ON work_orders(tenant_id, work_order_ref) 
WHERE work_order_ref IS NOT NULL;

-- Function to generate work order reference
-- Format: WO-{job_number}-{sequence}
-- Example: WO-IRC1001-001, WO-IRC1001-002, etc.
CREATE OR REPLACE FUNCTION generate_work_order_ref(p_tenant_id UUID, p_job_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_job_number TEXT;
  v_sequence INTEGER;
  v_ref TEXT;
BEGIN
  -- Get the job number
  SELECT job_number INTO v_job_number
  FROM jobs
  WHERE id = p_job_id AND tenant_id = p_tenant_id;
  
  IF v_job_number IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Get the next sequence number for this job
  SELECT COALESCE(MAX(CAST(
    SUBSTRING(work_order_ref FROM POSITION('-' IN work_order_ref) + 1) 
    AS INTEGER)), 0) + 1
  INTO v_sequence
  FROM work_orders
  WHERE tenant_id = p_tenant_id 
    AND job_id = p_job_id 
    AND work_order_ref ~ '^WO-';
  
  -- Generate the reference
  v_ref := 'WO-' || v_job_number || '-' || LPAD(v_sequence::TEXT, 3, '0');
  
  RETURN v_ref;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate work_order_ref on insert
CREATE OR REPLACE FUNCTION auto_generate_work_order_ref()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.work_order_ref IS NULL THEN
    NEW.work_order_ref := generate_work_order_ref(NEW.tenant_id, NEW.job_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_generate_work_order_ref
BEFORE INSERT ON work_orders
FOR EACH ROW
EXECUTE FUNCTION auto_generate_work_order_ref();
