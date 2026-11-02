-- The daily job review (tech spec §23.14): IRC reads each open job that has
-- changed since it was last read (and, once a week, the ones gone quiet),
-- notes where it stands, and plans dated checks as follow-ups ("did the
-- painter go on Saturday?"). These say when a job was last read, and what the
-- AI made of it then, so an unchanged job isn't read again.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS review_note TEXT;
