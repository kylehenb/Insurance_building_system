-- Add invoice_to field to jobs and insurer_orders tables
-- This field stores the trading_name of the client to invoice

-- Add to jobs table
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS invoice_to TEXT;

-- Add to insurer_orders table
ALTER TABLE insurer_orders
  ADD COLUMN IF NOT EXISTS invoice_to TEXT;

-- Add comments explaining the field
COMMENT ON COLUMN jobs.invoice_to IS 'Trading name of the client to invoice (must match insurer or adjuster on the job)';
COMMENT ON COLUMN insurer_orders.invoice_to IS 'Trading name of the client to invoice (must match insurer or adjuster on the order)';
