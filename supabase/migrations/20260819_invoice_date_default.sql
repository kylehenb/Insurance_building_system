-- issued_date is the invoice's "Invoice Date" — user-editable while the invoice is a
-- draft, then locked once it is sent. Default it to the creation date so every invoice
-- (all types, no exceptions) starts with a date, and backfill rows created before this
-- default existed.
ALTER TABLE invoices
  ALTER COLUMN issued_date SET DEFAULT CURRENT_DATE;

UPDATE invoices
SET issued_date = COALESCE(created_at::date, CURRENT_DATE)
WHERE issued_date IS NULL;
