CREATE TABLE IF NOT EXISTS invoice_line_item_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  invoice_type TEXT NOT NULL,
  description TEXT NOT NULL,
  default_quantity NUMERIC DEFAULT 1,
  default_unit_price NUMERIC,
  unit TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE invoice_line_item_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON invoice_line_item_library
  USING (tenant_id = (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

CREATE INDEX IF NOT EXISTS idx_invoice_line_item_library_tenant
  ON invoice_line_item_library(tenant_id, invoice_type);

-- Now that the library table exists, add the FK from invoice_line_items
ALTER TABLE invoice_line_items
ADD FOREIGN KEY (library_item_id) REFERENCES invoice_line_item_library(id);
