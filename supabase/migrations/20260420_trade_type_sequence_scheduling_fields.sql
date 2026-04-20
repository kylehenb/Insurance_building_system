-- Add scheduling hint fields to trade_type_sequence table
-- These fields help the AI draft repair schedule blueprints with proper dependencies and timing

ALTER TABLE trade_type_sequence
  ADD COLUMN IF NOT EXISTS typical_depends_on TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS can_run_concurrent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS typical_lag_days INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lag_description TEXT;
