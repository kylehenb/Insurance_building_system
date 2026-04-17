-- Drop job_margin_summary view (depends on status column)
DROP VIEW IF EXISTS job_margin_summary;

-- Drop status column from jobs table
ALTER TABLE jobs DROP COLUMN IF EXISTS status;

-- Recreate job_margin_summary view without status column
CREATE OR REPLACE VIEW job_margin_summary AS
SELECT
  j.id AS job_id,
  j.tenant_id,
  j.job_number,
  j.insured_name,
  COALESCE(SUM(CASE WHEN si.approval_status = 'approved' THEN si.line_total ELSE 0 END), 0) AS approved_quote_total,
  COALESCE(SUM(CASE WHEN i.direction = 'outbound' AND i.status != 'voided' THEN i.amount_ex_gst ELSE 0 END), 0) AS total_invoiced_ex_gst,
  COALESCE(SUM(CASE WHEN i.direction = 'inbound' AND i.status = 'approved' THEN i.amount_ex_gst ELSE 0 END), 0) AS total_trade_cost_ex_gst,
  COALESCE(SUM(CASE WHEN i.direction = 'outbound' AND i.status != 'voided' THEN i.amount_ex_gst ELSE 0 END), 0)
  - COALESCE(SUM(CASE WHEN i.direction = 'inbound' AND i.status = 'approved' THEN i.amount_ex_gst ELSE 0 END), 0)
  AS gross_margin_ex_gst
FROM jobs j
LEFT JOIN quotes q ON q.job_id = j.id AND q.is_active_version = true
LEFT JOIN scope_items si ON si.quote_id = q.id
LEFT JOIN invoices i ON i.job_id = j.id
GROUP BY j.id, j.tenant_id, j.job_number, j.insured_name;
