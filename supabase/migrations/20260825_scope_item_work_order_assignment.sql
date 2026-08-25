-- Allow a scope item to be explicitly assigned to a work order other than the
-- one implied by its trade string, so a contractor can pick up line items
-- that were originally quoted under a different trade (e.g. a painter also
-- covering a ceiling-fixer item).
--
-- NULL (default) preserves today's behavior: the item belongs to whichever
-- work order's trade_name matches its own trade string. Setting this column
-- overrides that match. Deleting a work order clears the column back to NULL
-- for any items pointing at it (see useWorkOrders.ts deleteWorkOrder), so
-- those items fall back to unallocated rather than disappearing.

ALTER TABLE scope_items
  ADD COLUMN IF NOT EXISTS assigned_work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_scope_items_assigned_work_order ON scope_items(assigned_work_order_id);
