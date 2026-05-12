-- Update inspection status values to use new naming convention
-- This migration updates the actual status values stored in the database

-- Update existing data to use new status names
UPDATE inspections 
SET status = 'make_safe_awaiting_assignment' 
WHERE status = 'urgent_awaiting_assignment';

UPDATE inspections 
SET status = 'appointment_proposed' 
WHERE status = 'proposed';

UPDATE inspections 
SET status = 'reschedule_required' 
WHERE status = 'awaiting_reschedule';

UPDATE inspections 
SET status = 'appointment_confirmed' 
WHERE status = 'confirmed';

UPDATE inspections 
SET status = 'inspection_started' 
WHERE status = 'in_progress';

UPDATE inspections 
SET status = 'review_and_send_all_docs' 
WHERE status = 'submitted';

UPDATE inspections 
SET status = 'sent_and_locked' 
WHERE status = 'complete';

-- Update comment to document the new status values
COMMENT ON COLUMN inspections.status IS 'Inspection status workflow: unscheduled | make_safe_awaiting_assignment | appointment_proposed | reschedule_required | appointment_confirmed | inspection_started | appointment_passed_not_started | review_and_send_all_docs | sent_and_locked';

-- Optional: Create a check constraint to ensure only valid statuses (PostgreSQL 12+)
-- ALTER TABLE inspections 
-- ADD CONSTRAINT inspections_status_check 
-- CHECK (status IN ('unscheduled', 'make_safe_awaiting_assignment', 'appointment_proposed', 'reschedule_required', 'appointment_confirmed', 'inspection_started', 'appointment_passed_not_started', 'review_and_send_all_docs', 'sent_and_locked'));
