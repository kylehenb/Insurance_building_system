-- Add trade_name to work_orders so work orders can be labelled correctly
-- even when no matching contractor record exists in the trades table.
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS trade_name TEXT;

-- Backfill trade_name from the linked trade record for existing rows
UPDATE work_orders wo
SET trade_name = t.primary_trade
FROM trades t
WHERE wo.trade_id = t.id
  AND wo.trade_name IS NULL;
