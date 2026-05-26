-- Rename xero columns to accounting-neutral names on invoices table
-- Idempotent: uses DO blocks to check before renaming

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='xero_invoice_id') THEN
    ALTER TABLE invoices RENAME COLUMN xero_invoice_id TO accounting_ref_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='xero_sync_status') THEN
    ALTER TABLE invoices RENAME COLUMN xero_sync_status TO accounting_sync_status;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='xero_sync_error') THEN
    ALTER TABLE invoices RENAME COLUMN xero_sync_error TO accounting_sync_error;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='xero_last_synced_at') THEN
    ALTER TABLE invoices RENAME COLUMN xero_last_synced_at TO accounting_last_synced_at;
  END IF;
END $$;

-- Add default value to accounting_sync_status if it doesn't already have it
ALTER TABLE invoices ALTER COLUMN accounting_sync_status SET DEFAULT 'pending';

-- Add accounting_bill_id for AP inbound invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS accounting_bill_id TEXT;
