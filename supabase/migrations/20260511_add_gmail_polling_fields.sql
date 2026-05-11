-- Add polling support fields to gmail_sync_state
-- This replaces the Gmail Watch + Pub/Sub mechanism with simpler polling

ALTER TABLE gmail_sync_state
  ADD COLUMN IF NOT EXISTS last_poll_timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS polling_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS polling_interval_minutes INTEGER DEFAULT 2;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_gmail_sync_state_tenant_email 
  ON gmail_sync_state(tenant_id, email_address);
