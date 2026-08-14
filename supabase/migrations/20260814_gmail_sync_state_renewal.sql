ALTER TABLE gmail_sync_state
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_renewal_status TEXT,
  ADD COLUMN IF NOT EXISTS last_renewal_error TEXT;
