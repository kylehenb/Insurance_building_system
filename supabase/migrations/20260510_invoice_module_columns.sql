-- Add gst_treatment to invoices
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS gst_treatment TEXT DEFAULT 'exclusive';
-- 'exclusive' = amount entered ex-GST, GST added on top
-- 'inclusive' = amount_inc_gst entered, ex-GST and GST derived backwards

-- Add library_item_id and unit to invoice_line_items
ALTER TABLE invoice_line_items
ADD COLUMN IF NOT EXISTS library_item_id UUID,
ADD COLUMN IF NOT EXISTS unit TEXT;
