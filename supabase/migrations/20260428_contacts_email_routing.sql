-- Contacts & Email Routing Overhaul
-- Replace additional_contacts TEXT with structured contacts JSONB
-- Add sender/adjuster fields for precise outbound email routing

-- 1a. Alter insurer_orders table
ALTER TABLE insurer_orders
  DROP COLUMN IF EXISTS additional_contacts,
  ADD COLUMN contacts JSONB DEFAULT '[]',
  ADD COLUMN adjuster_reference TEXT,
  ADD COLUMN order_sender_name TEXT,
  ADD COLUMN order_sender_email TEXT;

-- 1b. Alter jobs table
ALTER TABLE jobs
  DROP COLUMN IF EXISTS additional_contacts,
  ADD COLUMN contacts JSONB DEFAULT '[]',
  ADD COLUMN adjuster_reference TEXT,
  ADD COLUMN order_sender_name TEXT,
  ADD COLUMN order_sender_email TEXT;

-- 1c. Alter clients table (add adjuster firm submission email as separate field)
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS adjuster_submission_email TEXT;
