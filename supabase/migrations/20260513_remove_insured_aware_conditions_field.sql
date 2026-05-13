-- Remove 'insured_aware_of_conditions' field from roof reports type_specific_fields
-- This removes the "Would the Insured Have Been Reasonably Aware of the Property Conditions Leading to the Claim?" field

UPDATE reports 
SET type_specific_fields = type_specific_fields - 'insured_aware_of_conditions'
WHERE report_type = 'roof' 
  AND type_specific_fields IS NOT NULL 
  AND type_specific_fields ? 'insured_aware_of_conditions';

-- Add a comment to document this change
COMMENT ON COLUMN reports.type_specific_fields IS 'Type-specific fields for different report types. Note: insured_aware_of_conditions field was removed on 2025-05-13.';
