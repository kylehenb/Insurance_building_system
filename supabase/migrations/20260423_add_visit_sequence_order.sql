-- Add sequence_order to work_order_visits table for independent visit ordering
-- This allows visits from the same work order to be placed at different positions in the blueprint

ALTER TABLE work_order_visits
ADD COLUMN sequence_order INTEGER;

-- Create index on sequence_order for efficient querying
CREATE INDEX idx_work_order_visits_sequence_order ON work_order_visits(sequence_order);

-- Add comment
COMMENT ON COLUMN work_order_visits.sequence_order IS 'Sequence order for independent visit positioning in the blueprint. Allows visits from the same work order to be interleaved with other work orders.';
