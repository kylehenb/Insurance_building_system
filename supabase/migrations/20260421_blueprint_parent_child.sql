-- Blueprint Parent/Child Relationship for Key Trade Scheduling
-- This allows key trades (e.g., cabinet maker) to control scheduling of dependent trades
-- When the key trade reschedules, all child trades reschedule with it

-- Add parent_work_order_id to work_orders
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS parent_work_order_id UUID REFERENCES work_orders(id);

-- Add scheduling_offset_days to work_orders
-- Positive value = this many days AFTER parent
-- Negative value = this many days BEFORE parent
-- NULL = not tied to parent scheduling
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS scheduling_offset_days INTEGER;

-- Add index for parent/child lookups
CREATE INDEX IF NOT EXISTS idx_work_orders_parent ON work_orders(parent_work_order_id);
