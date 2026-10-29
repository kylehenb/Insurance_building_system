-- Order parsing, report writing and photo labelling on the learning module
-- (tech spec §24.4). An order keeps the situation it was parsed in (who sent
-- it, which insurer); a report keeps the AI's draft, so what the assessor
-- changed before locking it can be learned from (once per draft).

ALTER TABLE insurer_orders ADD COLUMN IF NOT EXISTS situation JSONB;

ALTER TABLE reports ADD COLUMN IF NOT EXISTS ai_draft JSONB;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS ai_draft_at TIMESTAMPTZ;
-- Set once the draft's outcome is recorded; a new draft clears it
ALTER TABLE reports ADD COLUMN IF NOT EXISTS ai_draft_learned_at TIMESTAMPTZ;
-- Set once the report's photo labels have been learned from
ALTER TABLE reports ADD COLUMN IF NOT EXISTS photo_labels_learned_at TIMESTAMPTZ;
