-- Invoice deductions table — editable line items for amounts deducted from an
-- invoice post-GST (e.g. policy excess already paid direct to the insured).
-- Replaces the single excess_deduction_inc_gst number that used to live inside
-- invoices.notes as JSON.
CREATE TABLE IF NOT EXISTS invoice_deductions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount_inc_gst NUMERIC NOT NULL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE invoice_deductions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON invoice_deductions
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_invoice_deductions_invoice ON invoice_deductions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_deductions_tenant ON invoice_deductions(tenant_id);

-- Quote linkage on invoice_line_items — lets the invoice UI/PDF group line
-- items under a "Quote {quote_ref}" subheading when an invoice pulls scope
-- items from more than one approved quote (quoted_amounts invoices).
-- quote_ref is a denormalized snapshot, not just a join key, so grouping/
-- display never needs an extra query and survives the quote being renamed.
ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS quote_id UUID REFERENCES quotes(id),
  ADD COLUMN IF NOT EXISTS quote_ref TEXT;

-- Backfill: existing quoted_amounts invoices stash their excess deduction as
-- JSON in notes ({"excess_deduction_inc_gst": N}). Move each into its own
-- invoice_deductions row and clear that system JSON out of notes. notes is
-- free-text for every other invoice type, so parse defensively per-row
-- rather than blindly casting notes::jsonb.
DO $$
DECLARE
  inv RECORD;
  parsed JSONB;
  deduction_amount NUMERIC;
BEGIN
  FOR inv IN
    SELECT id, tenant_id, notes
    FROM invoices
    WHERE invoice_type = 'quoted_amounts'
      AND notes IS NOT NULL
      AND notes LIKE '{%'
  LOOP
    BEGIN
      parsed := inv.notes::jsonb;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;

    IF parsed ? 'excess_deduction_inc_gst' THEN
      deduction_amount := (parsed->>'excess_deduction_inc_gst')::numeric;
      IF deduction_amount > 0 THEN
        INSERT INTO invoice_deductions (tenant_id, invoice_id, description, amount_inc_gst, sort_order)
        VALUES (inv.tenant_id, inv.id, 'Policy Excess Payment Received', deduction_amount, 0);
      END IF;
      UPDATE invoices SET notes = NULL WHERE id = inv.id;
    END IF;
  END LOOP;
END $$;
