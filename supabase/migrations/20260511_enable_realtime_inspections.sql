-- Enable Realtime for inspections table
-- This allows real-time subscriptions to inspection updates

ALTER PUBLICATION supabase_realtime ADD TABLE inspections;
