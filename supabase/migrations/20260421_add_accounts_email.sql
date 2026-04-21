-- Add accounts_email column to tenants table
-- Separate email for accounts-related communications (invoices, payments, etc.)

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS accounts_email TEXT;

-- Add comment for documentation
COMMENT ON COLUMN tenants.accounts_email IS 'Email address for accounts-related communications (invoices, payments, financial correspondence)';
