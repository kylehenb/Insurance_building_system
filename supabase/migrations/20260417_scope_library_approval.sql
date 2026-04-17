-- Add approval_status field to scope_library table
ALTER TABLE scope_library ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'approved';
COMMENT ON COLUMN scope_library.approval_status IS 'Approval status for scope library items: pending, approved';

-- Create index on approval_status for faster filtering
CREATE INDEX IF NOT EXISTS scope_library_approval_status_idx ON scope_library(approval_status);

-- Update existing items to be approved by default
UPDATE scope_library SET approval_status = 'approved' WHERE approval_status IS NULL;
