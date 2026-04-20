-- Add scheduling hint fields to trade_type_sequence table
-- These fields help the AI draft repair schedule blueprints with proper dependencies and timing

ALTER TABLE trade_type_sequence
  ADD COLUMN IF NOT EXISTS typical_depends_on TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS typical_comes_before TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS typically_paired_with TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS can_run_concurrent_with TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cant_run_concurrent_with TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS typical_lag_days INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lag_description TEXT;

-- Remove old can_run_concurrent field if it exists (replaced by can_run_concurrent_with and cant_run_concurrent_with)
ALTER TABLE trade_type_sequence DROP COLUMN IF EXISTS can_run_concurrent;
