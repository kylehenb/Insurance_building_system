-- Add financial configuration fields to clients table
-- These fields allow per-insurer pricing and margin configuration

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS bar_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS single_storey_roof_report_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS double_storey_roof_report_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS travel_allowance_outside_service_area NUMERIC,
  ADD COLUMN IF NOT EXISTS builders_margin_pct NUMERIC;

-- Add comments for documentation
COMMENT ON COLUMN clients.bar_amount IS 'Standard BAR (Building Assessment Report) fee for this insurer';
COMMENT ON COLUMN clients.single_storey_roof_report_amount IS 'Roof report fee for single-storey properties';
COMMENT ON COLUMN clients.double_storey_roof_report_amount IS 'Roof report fee for double-storey properties';
COMMENT ON COLUMN clients.travel_allowance_outside_service_area IS 'Travel allowance per km for work outside standard service area ($/km)';
COMMENT ON COLUMN clients.builders_margin_pct IS 'Builder margin percentage (e.g. 20 for 20%)';
