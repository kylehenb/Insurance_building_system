-- Add raw_email_subject field to insurer_orders table
-- This will store the original email subject separately from claim_description
-- allowing proper parsing of claim description from email body/attachments

ALTER TABLE insurer_orders
  ADD COLUMN IF NOT EXISTS raw_email_subject TEXT;
