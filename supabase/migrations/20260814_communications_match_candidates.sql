-- Add match_candidates JSONB column to communications.
-- Populated by the Gemini job-matching step when confidence is below the
-- auto-link threshold. Used by the manual-link UI to surface "did you mean
-- job #X?" suggestions.
--
-- Schema of each element in the array:
--   {
--     job_id:          string (uuid)
--     job_number:      string
--     insured_name:    string | null
--     property_address: string | null
--     claim_number:    string | null
--     matched_on:      string[]   e.g. ["property_address", "insured_name"]
--     confidence:      "high" | "low"
--   }

ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS match_candidates JSONB NULL;
