-- Add estimated_hours to scope_items table
-- This allows custom items (not from scope library) to have their own duration estimates
-- which are needed for AI blueprint generation

ALTER TABLE scope_items 
ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC;

COMMENT ON COLUMN scope_items.estimated_hours IS 'Labour hours per unit for this line item. For custom items, this is set manually. For library items, this can be inherited from scope_library or overridden.';
