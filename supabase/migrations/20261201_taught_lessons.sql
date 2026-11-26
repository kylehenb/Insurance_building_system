-- Lessons the office taught (tech spec §24.8): from the debrief of what the
-- owner said about a card, or "remember this". feature 'office' is the shared
-- office memory every feature reads.
ALTER TABLE learning_lessons DROP CONSTRAINT IF EXISTS learning_lessons_source_check;
ALTER TABLE learning_lessons ADD CONSTRAINT learning_lessons_source_check CHECK (source IN ('learned', 'migrated', 'taught'));
