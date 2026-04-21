-- Add building_licence_number column to tenants table
-- Building licence number for regulatory compliance and documentation

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS building_licence_number TEXT;

-- Add comment for documentation
COMMENT ON COLUMN tenants.building_licence_number IS 'Building licence number for regulatory compliance and documentation';
