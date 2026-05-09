-- Add raw email body and email attachments fields to insurer_orders
-- These fields will store the full email content and attachment metadata from parsed emails

ALTER TABLE insurer_orders
  ADD COLUMN IF NOT EXISTS raw_email_body TEXT,
  ADD COLUMN IF NOT EXISTS email_attachments JSONB DEFAULT '[]';
