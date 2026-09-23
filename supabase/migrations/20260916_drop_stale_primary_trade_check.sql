-- The `trades.primary_trade` column had a CHECK constraint
-- (`check_primary_trade_approved`) that hardcoded an allow-list of trade
-- names. It was applied directly to the database outside the tracked
-- migration history, so it never stayed in sync with `trade_type_sequence`
-- (the tenant-editable trade catalog managed via Trade Types settings).
-- Any trade type added there fails this constraint until it happens to
-- match the stale hardcoded list. There is no approval workflow in the
-- app that this constraint could correspond to, so it is dropped outright;
-- `trade_type_sequence` is the source of truth for valid trade names.
alter table public.trades
  drop constraint if exists check_primary_trade_approved;
