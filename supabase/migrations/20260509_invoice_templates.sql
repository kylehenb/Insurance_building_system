-- Create invoice_templates table for standardized invoice descriptions
-- Templates are tenant-level, allowing standardized descriptions across all clients
-- Pricing remains at the client level for flexibility

CREATE TABLE invoice_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  template_code TEXT NOT NULL,
  template_name TEXT NOT NULL,
  description TEXT NOT NULL,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, template_code)
);

-- Add RLS policy
ALTER TABLE invoice_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON invoice_templates
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Add comments for documentation
COMMENT ON TABLE invoice_templates IS 'Standardized invoice description templates at tenant level';
COMMENT ON COLUMN invoice_templates.template_code IS 'Unique code for template type: bar, single_storey_roof, double_storey_roof, leak_detection, make_safe';
COMMENT ON COLUMN invoice_templates.template_name IS 'Human-readable name: Building Assessment Report, Single Storey Roof Report, etc.';
COMMENT ON COLUMN invoice_templates.description IS 'Line item description template - can include placeholders like {property_address}, {claim_number}';
COMMENT ON COLUMN invoice_templates.notes IS 'Default notes for this invoice type';
