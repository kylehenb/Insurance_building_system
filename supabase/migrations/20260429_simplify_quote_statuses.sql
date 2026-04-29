-- Simplify quote statuses to: draft, ready, sent, approved, partially_approved, rejected
-- Migrates all extended statuses introduced after the phase-2 constraint back to the
-- canonical set that getJobStage and the application now expect.

-- 1. Migrate existing data
UPDATE quotes SET status = 'sent'     WHERE status = 'sent_to_insurer';
UPDATE quotes SET status = 'approved' WHERE status IN (
  'approved_contracts_pending',
  'approved_contracts_sent',
  'approved_contracts_signed',
  'pre_repair',
  'repairs_in_progress',
  'repairs_complete_to_invoice',
  'complete_and_invoiced'
);
UPDATE quotes SET status = 'rejected' WHERE status IN (
  'declined_superseded',
  'declined_claim_declined'
);

-- 2. Drop the stale constraint and replace it with the canonical six values
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_status_check;

ALTER TABLE quotes
  ADD CONSTRAINT quotes_status_check
  CHECK (status IN ('draft', 'ready', 'sent', 'approved', 'partially_approved', 'rejected'));
