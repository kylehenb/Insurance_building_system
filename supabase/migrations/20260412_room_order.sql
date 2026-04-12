-- Add room_order field to quotes table to persist room ordering
-- This stores an array of room names in the desired order

ALTER TABLE quotes
ADD COLUMN room_order TEXT[] DEFAULT NULL;

-- Add room_order to the allowed updates in the API
-- No additional changes needed - it's a JSONB-compatible field
