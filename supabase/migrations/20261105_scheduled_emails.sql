-- Mail client phase 4: scheduled send.
--
-- A scheduled email is a Gmail draft plus a row here saying when to send it.
-- The /api/gmail/scheduled-send cron (every minute) claims due rows and sends
-- their drafts. Until then it's an ordinary draft (in the Gmail app's Drafts
-- too); Gmail's own Scheduled folder can't be used through the API.
--
-- status: scheduled → sending → sent | failed; cancelled when taken off the
-- schedule (edited, discarded or sent by hand).
--
-- No RLS policies: only the server reads these, behind mail.view / mail.send.

CREATE TABLE IF NOT EXISTS scheduled_emails (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mailbox_id     UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  gmail_draft_id TEXT NOT NULL,
  thread_id      TEXT,
  send_at        TIMESTAMPTZ NOT NULL,
  status         TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  -- For the Scheduled list without asking Gmail
  subject        TEXT,
  recipients     TEXT,
  error          TEXT,
  sent_message_id TEXT,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One live schedule per draft
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_emails_live_draft
  ON scheduled_emails (mailbox_id, gmail_draft_id) WHERE status IN ('scheduled', 'sending');
CREATE INDEX IF NOT EXISTS idx_scheduled_emails_due
  ON scheduled_emails (send_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_scheduled_emails_tenant ON scheduled_emails (tenant_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_emails_created_by ON scheduled_emails (created_by);

ALTER TABLE scheduled_emails ENABLE ROW LEVEL SECURITY;
