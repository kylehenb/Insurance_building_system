-- Enable Realtime for jobs table
-- Used by components/jobs/StageBanner.tsx to receive live current_stage /
-- current_stage_updated_at / override_stage updates via postgres_changes,
-- replacing a 3-second setInterval poll that was generating unnecessary
-- query volume on the jobs table for as long as a job page stayed open.

ALTER PUBLICATION supabase_realtime ADD TABLE jobs;
