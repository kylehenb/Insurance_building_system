-- Add completed flag to invoice line items.
-- Existing rows default to true (completed). Incomplete items are struck through
-- on the invoice but still visible, with an effective charge of $0.
ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS completed boolean NOT NULL DEFAULT true;
