-- Add alternative logo and financial details to tenants table
-- Alternative logo for secondary branding (e.g., dark mode or specialized documents)
-- Financial details for invoicing and payment processing

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS alternative_logo_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS bsb TEXT,
  ADD COLUMN IF NOT EXISTS account_number TEXT,
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS account_name TEXT;

-- Add comments for documentation
COMMENT ON COLUMN tenants.alternative_logo_storage_path IS 'Path in Supabase Storage for alternative logo (e.g., dark mode or specialized documents)';
COMMENT ON COLUMN tenants.bsb IS 'Bank State Branch number for payment processing';
COMMENT ON COLUMN tenants.account_number IS 'Bank account number for payments';
COMMENT ON COLUMN tenants.bank_name IS 'Name of the bank';
COMMENT ON COLUMN tenants.account_name IS 'Account holder name for payments';
