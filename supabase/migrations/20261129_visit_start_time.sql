-- A trade's start time on a visit (tech spec §23.18 "Schedule"). Null: the
-- visit is all day (the default — "painter Thursday"); a time when one was
-- given ("electrician 7am to disconnect"). Times are Perth local. No end time:
-- a timed visit shows from its start.
ALTER TABLE work_order_visits ADD COLUMN IF NOT EXISTS start_time TIME;
