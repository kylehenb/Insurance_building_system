-- Add missing trades fields from spec v3.0
-- priority_rank, lat, lng, availability

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS priority_rank INTEGER DEFAULT 50,
  ADD COLUMN IF NOT EXISTS lat NUMERIC,
  ADD COLUMN IF NOT EXISTS lng NUMERIC,
  ADD COLUMN IF NOT EXISTS availability TEXT DEFAULT 'maintain_capacity';

-- Add comment for availability field
COMMENT ON COLUMN trades.availability IS 'Scheduling capacity: more_capacity | maintain_capacity | reduce_capacity | on_pause';

-- Add comment for priority_rank
COMMENT ON COLUMN trades.priority_rank IS 'General priority ranking (lower number = higher priority)';

-- Add comment for lat/lng
COMMENT ON COLUMN trades.lat IS 'Geocoded latitude for proximity calculation';
COMMENT ON COLUMN trades.lng IS 'Geocoded longitude for proximity calculation';
