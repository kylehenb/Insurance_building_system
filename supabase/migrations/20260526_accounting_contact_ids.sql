ALTER TABLE clients ADD COLUMN IF NOT EXISTS accounting_contact_id TEXT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS accounting_contact_id TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS homeowner_accounting_contact_id TEXT;
