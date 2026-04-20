-- Add trading_name, abn, and service_area_config columns to tenants table

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trading_name TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS abn TEXT;
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS service_area_config JSONB
  DEFAULT '{"radius_zones":[],"specific_areas":[],"cat_areas":[]}';

COMMENT ON COLUMN tenants.trading_name IS 'Optional trading name (may differ from legal business name)';
COMMENT ON COLUMN tenants.abn IS 'Australian Business Number (11 digits, no spaces)';
COMMENT ON COLUMN tenants.service_area_config IS 'JSONB config for radius zones, specific suburb areas, and CAT service areas';
