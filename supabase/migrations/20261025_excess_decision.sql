-- Excess decision on jobs + excess invoice sent with a signing request
-- (tech spec v3.3 §4.5, §4.32, §10a). Additive only.
--
-- jobs.excess stays the policy excess amount. The new columns record what the
-- office decided to do about it, so "no excess" and "not checked yet" are no
-- longer the same thing (blank). NULL = not confirmed yet.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS excess_decision TEXT
    CHECK (excess_decision IN (
      'collect',          -- collect the excess from the homeowner (excess invoice)
      'nil',              -- confirmed: no excess on this claim
      'cash_settlement',  -- not collected: insurer deducted it from a partial cash settlement
      'insurer_waived',   -- not collected: insurer waived it
      'already_paid',     -- not collected: already paid
      'other'             -- not collected: other reason (see note)
    )),
  ADD COLUMN IF NOT EXISTS excess_decision_note TEXT,
  ADD COLUMN IF NOT EXISTS excess_decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS excess_decided_by UUID REFERENCES users(id);

-- The excess invoice that went out with a signing request (null if none)
ALTER TABLE signing_requests
  ADD COLUMN IF NOT EXISTS excess_invoice_id UUID REFERENCES invoices(id);
