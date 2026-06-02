-- Add builder's margin to make_safe invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS markup_pct numeric NULL;
