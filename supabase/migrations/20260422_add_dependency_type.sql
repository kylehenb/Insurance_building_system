-- Add dependency_type column to work_orders table
-- This will store the type of dependency relationship between work orders

ALTER TABLE work_orders
ADD COLUMN IF NOT EXISTS dependency_type TEXT DEFAULT 'finish-to-start';

-- Add check constraint to ensure only valid dependency types
ALTER TABLE work_orders
ADD CONSTRAINT check_dependency_type 
CHECK (dependency_type IN ('finish-to-start', 'start-to-start', 'finish-to-finish', 'start-to-finish', NULL));

-- Add comment to document the column
COMMENT ON COLUMN work_orders.dependency_type IS 'Type of dependency relationship: finish-to-start (default), start-to-start, finish-to-finish, start-to-finish';
