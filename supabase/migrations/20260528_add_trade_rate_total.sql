-- Add trade_rate_total to scope_library
ALTER TABLE scope_library
ADD COLUMN IF NOT EXISTS trade_rate_total NUMERIC;

-- Add trade_rate_total to scope_items
ALTER TABLE scope_items
ADD COLUMN IF NOT EXISTS trade_rate_total NUMERIC;

COMMENT ON COLUMN scope_library.trade_rate_total IS 'What the trade is paid per unit. Internal only. Never sent externally. Single combined rate — no labour/materials split needed for trade payments.';
COMMENT ON COLUMN scope_items.trade_rate_total IS 'Copied from scope_library at quote creation. Editable inline in quote editor (admin only). Used to calculate margin and populate work order trade payment figures.';
