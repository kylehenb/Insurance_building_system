-- Add service area field to trades table
-- Allows trades to have multiple service areas (e.g., "30kms radius", "50kms radius", "regional")
-- Default is "30kms radius from the trades address"

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS service_area TEXT[] DEFAULT ARRAY['30kms radius'];

-- Add comment for service_area field
COMMENT ON COLUMN trades.service_area IS 'Service area options for the trade (e.g., "30kms radius", "50kms radius"). Can have multiple values. Default is "30kms radius from the trades address".';
