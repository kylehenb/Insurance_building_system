-- Mail client phase 5: filing, job context and snooze (/dashboard/mail).
--
-- mail_threads.filing / job_id: where the conversation stands in IRC, worked
-- out from the emails filed in communications (lib/mail/filing.ts):
--   job      — on a job (job_id)
--   to_file  — recorded but not on a job yet (the old "unlinked inbox");
--              insurer order emails aren't, they wait in the Insurer Orders queue
--   admin    — filed as not job related
--   null     — never recorded (e.g. newsletters, mail from before the app)
-- Kept up to date when threads sync and whenever a thread is linked or filed.

ALTER TABLE mail_threads
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS filing TEXT CHECK (filing IN ('job', 'to_file', 'admin'));

CREATE INDEX IF NOT EXISTS idx_mail_threads_filing ON mail_threads (mailbox_id, filing);
CREATE INDEX IF NOT EXISTS idx_mail_threads_job ON mail_threads (job_id);

-- Backfill from what's already filed
WITH linked AS (
  SELECT DISTINCT ON (c.tenant_id, c.thread_id) c.tenant_id, c.thread_id, c.job_id
  FROM communications c
  WHERE c.thread_id IS NOT NULL AND c.job_id IS NOT NULL
  ORDER BY c.tenant_id, c.thread_id, c.created_at DESC
)
UPDATE mail_threads t SET job_id = l.job_id, filing = 'job'
FROM linked l
WHERE l.tenant_id = t.tenant_id AND l.thread_id = t.gmail_thread_id;

UPDATE mail_threads t SET filing = CASE WHEN EXISTS (
    SELECT 1 FROM communications c
    WHERE c.tenant_id = t.tenant_id AND c.thread_id = t.gmail_thread_id AND c.job_id IS NULL AND c.source = 'admin'
  ) THEN 'admin' ELSE 'to_file' END
WHERE t.filing IS NULL AND EXISTS (
  SELECT 1 FROM communications c
  WHERE c.tenant_id = t.tenant_id AND c.thread_id = t.gmail_thread_id AND c.direction = 'inbound'
) AND (
  -- Order emails wait in the Insurer Orders queue (unless filed as admin)
  NOT EXISTS (SELECT 1 FROM communications c WHERE c.tenant_id = t.tenant_id AND c.thread_id = t.gmail_thread_id AND c.insurer_order_id IS NOT NULL)
  OR EXISTS (SELECT 1 FROM communications a WHERE a.tenant_id = t.tenant_id AND a.thread_id = t.gmail_thread_id AND a.source = 'admin')
);

-- The job an email is being written about: the sent copy is filed on it
ALTER TABLE mail_drafts
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_mail_drafts_job ON mail_drafts (job_id);

-- Snooze: Gmail has no snooze through the API, so a snoozed conversation is
-- archived and this row brings it back to the inbox, unread, at `until`
-- (the scheduled-send cron, every minute). A new message wakes it early.
CREATE TABLE IF NOT EXISTS mail_snoozes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mailbox_id      UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  gmail_thread_id TEXT NOT NULL,
  until           TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'snoozed' CHECK (status IN ('snoozed', 'woken', 'cancelled')),
  -- Shown in the Snoozed list without asking Gmail
  subject         TEXT,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_snoozes_live
  ON mail_snoozes (mailbox_id, gmail_thread_id) WHERE status = 'snoozed';
CREATE INDEX IF NOT EXISTS idx_mail_snoozes_due ON mail_snoozes (until) WHERE status = 'snoozed';
CREATE INDEX IF NOT EXISTS idx_mail_snoozes_tenant ON mail_snoozes (tenant_id);
CREATE INDEX IF NOT EXISTS idx_mail_snoozes_created_by ON mail_snoozes (created_by);

ALTER TABLE mail_snoozes ENABLE ROW LEVEL SECURITY;
