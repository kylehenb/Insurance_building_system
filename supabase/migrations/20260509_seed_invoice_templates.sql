-- Seed standard invoice templates
-- These are the default templates for common report types
-- Note: This uses a placeholder tenant_id - in production, each tenant would have their own templates

-- Building Assessment Report template
INSERT INTO invoice_templates (tenant_id, template_code, template_name, description, notes)
VALUES (
  (SELECT id FROM tenants LIMIT 1),
  'bar',
  'Building Assessment Report',
  'Building Assessment Report - {property_address}',
  'Standard fee for initial assessment and report preparation'
) ON CONFLICT (tenant_id, template_code) DO NOTHING;

-- Single Storey Roof Report template
INSERT INTO invoice_templates (tenant_id, template_code, template_name, description, notes)
VALUES (
  (SELECT id FROM tenants LIMIT 1),
  'single_storey_roof',
  'Single Storey Roof Report',
  'Single Storey Roof Assessment Report - {property_address}',
  'Roof inspection and report for single-storey property'
) ON CONFLICT (tenant_id, template_code) DO NOTHING;

-- Double Storey Roof Report template
INSERT INTO invoice_templates (tenant_id, template_code, template_name, description, notes)
VALUES (
  (SELECT id FROM tenants LIMIT 1),
  'double_storey_roof',
  'Double Storey Roof Report',
  'Double Storey Roof Assessment Report - {property_address}',
  'Roof inspection and report for double-storey property'
) ON CONFLICT (tenant_id, template_code) DO NOTHING;

-- Leak Detection Report template
INSERT INTO invoice_templates (tenant_id, template_code, template_name, description, notes)
VALUES (
  (SELECT id FROM tenants LIMIT 1),
  'leak_detection',
  'Leak Detection Report',
  'Leak Detection Report - {property_address}',
  'Investigation and report for water leak identification'
) ON CONFLICT (tenant_id, template_code) DO NOTHING;

-- Make Safe template
INSERT INTO invoice_templates (tenant_id, template_code, template_name, description, notes)
VALUES (
  (SELECT id FROM tenants LIMIT 1),
  'make_safe',
  'Make Safe Report',
  'Make Safe Report - {property_address}',
  'Emergency make safe works and report'
) ON CONFLICT (tenant_id, template_code) DO NOTHING;
