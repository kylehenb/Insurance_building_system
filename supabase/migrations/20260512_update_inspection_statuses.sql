-- Update inspection statuses to match new workflow
-- This migration updates the status field to use the new status values

-- No ALTER TABLE needed since we're just using different values in the existing TEXT column
-- The existing status column is already TEXT and can accommodate these new values

-- Update any existing data that might need mapping
-- Note: Only run these if you have existing data with old status values

-- Map old 'draft' status to 'unscheduled' 
UPDATE inspections 
SET status = 'unscheduled' 
WHERE status = 'draft';

-- Map old 'scheduled' status to 'confirmed' (if any exist)
UPDATE inspections 
SET status = 'confirmed' 
WHERE status = 'scheduled';

-- Add comment to document the new valid statuses
COMMENT ON COLUMN inspections.status IS 'Inspection status workflow: unscheduled | urgent_awaiting_assignment | proposed | awaiting_reschedule | confirmed | in_progress | appointment_passed_not_started | submitted | complete';

-- Optional: Create a check constraint to ensure only valid statuses (PostgreSQL 12+)
-- ALTER TABLE inspections 
-- ADD CONSTRAINT inspections_status_check 
-- CHECK (status IN ('unscheduled', 'urgent_awaiting_assignment', 'proposed', 'awaiting_reschedule', 'confirmed', 'in_progress', 'appointment_passed_not_started', 'submitted', 'complete'));
