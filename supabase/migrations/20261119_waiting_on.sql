-- Waiting on (tech spec §23.12): every email the office sends is read once,
-- and when it asks someone for something (a trade for photos, an insurer for
-- approval) a follow-up is set for the person who sent it. A reply in that
-- conversation closes it; if none comes, it comes onto the action cards with
-- the chase drafted. The follow-up itself is an ordinary follow-up card
-- (action_queue, source 'followup', follow_up.kind 'waiting_on').
--
-- sent_emails is both who sent each email (written when it's sent from IRC —
-- the office shares one mailbox, so Gmail can't say) and the queue of sent
-- emails still to read (added by the mailbox sync for every send, from IRC or
-- Gmail). Server only (the service role): RLS on, no browser policies.

CREATE TABLE IF NOT EXISTS sent_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  thread_id TEXT,
  -- Who in the office sent it; null when sent from Gmail itself or by an automation
  sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
  -- new: still to read; reading: being read; done: read (asked for something or not); failed: gave up
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reading', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  -- What the AI made of it, in a line ("Asked Ace Roofing for the roof quote" / "Asks for nothing")
  outcome TEXT,
  -- The follow-up it set, if any
  follow_up_id UUID REFERENCES action_queue(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, gmail_message_id)
);

CREATE INDEX IF NOT EXISTS idx_sent_emails_queue ON sent_emails (status, created_at) WHERE status IN ('new', 'reading');
CREATE INDEX IF NOT EXISTS idx_sent_emails_thread ON sent_emails (tenant_id, thread_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_sent_by ON sent_emails (sent_by);
CREATE INDEX IF NOT EXISTS idx_sent_emails_follow_up ON sent_emails (follow_up_id);

ALTER TABLE sent_emails ENABLE ROW LEVEL SECURITY;
