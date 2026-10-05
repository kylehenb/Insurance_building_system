-- Notification emails must not contain emojis (they render as mojibake in some email clients).
-- Update the subject defaults and backfill any existing config rows still on the old emoji defaults.

ALTER TABLE auto_job_lodger_config
  ALTER COLUMN notification_subject_success SET DEFAULT 'New job lodged — {claim_number} — {insured_name}',
  ALTER COLUMN notification_subject_review SET DEFAULT 'Order needs review — {original_subject}';

UPDATE auto_job_lodger_config
SET notification_subject_success = 'New job lodged — {claim_number} — {insured_name}'
WHERE notification_subject_success = '✅ Order parsed — {claim_number} — {insured_name}';

UPDATE auto_job_lodger_config
SET notification_subject_review = 'Order needs review — {original_subject}'
WHERE notification_subject_review = '⚠️ Order needs review — {original_subject}';
