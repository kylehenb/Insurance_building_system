-- Add payment terms configuration to tenants table
-- invoice_payment_terms: days for standard invoices (default 14)
-- excess_payment_terms: days for excess invoices (default 0)

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS invoice_payment_terms INTEGER DEFAULT 14,
  ADD COLUMN IF NOT EXISTS excess_payment_terms INTEGER DEFAULT 0;
