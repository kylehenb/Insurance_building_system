-- Voiding an invoice keeps it (status 'voided') with who voided it, when and
-- why (lib/invoices/void.ts). Voided invoices are left out of job totals,
-- balance and quoted-amounts deductions, and the payment poll.
-- accounting_sync_status 'voided': the accounting system's copy was voided too.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by   UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS void_reason TEXT;
