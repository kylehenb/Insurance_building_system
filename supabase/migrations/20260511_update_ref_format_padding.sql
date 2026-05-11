-- Update generate_work_order_ref to remove 3-digit padding
-- Changed format from WO-IRC1001-001 to WO-IRC1001-1
-- Also updated quotes (Q-IRC1001-1) and invoices (INV-IRC1001-1) to match

CREATE OR REPLACE FUNCTION generate_work_order_ref(p_tenant_id UUID, p_job_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_job_number TEXT;
  v_sequence INTEGER;
  v_ref TEXT;
BEGIN
  SELECT job_number INTO v_job_number
  FROM jobs
  WHERE id = p_job_id AND tenant_id = p_tenant_id;

  IF v_job_number IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(MAX(CAST(SUBSTRING(work_order_ref FROM '-(\d+)$') AS INTEGER)), 0) + 1
  INTO v_sequence
  FROM work_orders
  WHERE tenant_id = p_tenant_id
    AND job_id = p_job_id
    AND work_order_ref ~ '^WO-.*-\d+$';

  v_ref := 'WO-' || v_job_number || '-' || v_sequence::TEXT;

  RETURN v_ref;
END;
$$ LANGUAGE plpgsql;
