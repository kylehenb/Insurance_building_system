-- Add inspection_id to invoices table to link invoices to inspections
-- This allows invoices to be linked to both reports and inspections
-- When a report is linked to an inspection, the corresponding invoice should also be linked

ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS inspection_id UUID REFERENCES inspections(id);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_invoices_inspection_id ON invoices(inspection_id);

-- Add comment explaining the relationship
COMMENT ON COLUMN invoices.inspection_id IS 'Links invoice to inspection. When a report is linked to an inspection, the corresponding invoice should also be linked to maintain consistency.';
