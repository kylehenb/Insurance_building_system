-- Remove is_concurrent field from work_orders table
-- This field has been superseded by the dependency system (predecessor_work_order_id)

ALTER TABLE work_orders
DROP COLUMN IF EXISTS is_concurrent;
