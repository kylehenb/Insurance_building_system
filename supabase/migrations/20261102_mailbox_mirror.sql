-- Mailbox mirror: the IRC mail client (/dashboard/mail).
--
-- Gmail is the source of truth for the mailbox — messages, labels (inbox,
-- sent, drafts, spam, bin), read state. These tables hold a disposable copy of
-- the conversation list so folders open instantly and threads can be joined to
-- jobs. Message bodies are never stored here; they are fetched from Gmail when
-- a conversation is opened. Dropping every mail_threads row and clearing
-- mailboxes.history_id rebuilds the copy from Gmail with nothing lost.
--
-- Kept in step by lib/mail/sync.ts, driven by the Gmail push webhook, a
-- 2-minute cron (/api/gmail/mailbox-sync) and opening the mail page.
--
-- No RLS policies: only the server (service role) reads these, behind the
-- mail.view permission. A mailbox is shared office mail, not tenant-wide data.

CREATE TABLE IF NOT EXISTS mailboxes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email_address TEXT NOT NULL,
  -- Gmail history cursor for this mirror. Separate from
  -- gmail_sync_state.last_history_id, which the order pipeline owns.
  history_id    TEXT,
  -- When the initial listing of recent threads was queued. Null = (re)do it.
  backfilled_at TIMESTAMPTZ,
  synced_at     TIMESTAMPTZ,
  sync_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email_address)
);

CREATE TABLE IF NOT EXISTS mail_threads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mailbox_id      UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  gmail_thread_id TEXT NOT NULL,
  subject         TEXT,
  snippet         TEXT,
  -- Senders in conversation order: [{ name, email, me }]
  participants    JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Recipients of the latest message, for the Sent and Drafts lists: [{ name, email }]
  recipients      JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_message_at TIMESTAMPTZ,
  message_count   INTEGER NOT NULL DEFAULT 0,
  -- Union of every message's Gmail labels (INBOX, SENT, DRAFT, SPAM, TRASH, UNREAD, Label_…)
  label_ids       TEXT[] NOT NULL DEFAULT '{}',
  unread          BOOLEAN NOT NULL DEFAULT false,
  has_attachments BOOLEAN NOT NULL DEFAULT false,
  -- Needs fetching from Gmail. New thread ids arrive as stale placeholders
  -- (no subject yet) and are filled in newest-queued first.
  stale           BOOLEAN NOT NULL DEFAULT true,
  queued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at       TIMESTAMPTZ,
  UNIQUE (mailbox_id, gmail_thread_id)
);

CREATE INDEX IF NOT EXISTS idx_mail_threads_list
  ON mail_threads (mailbox_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_threads_labels
  ON mail_threads USING gin (label_ids);
CREATE INDEX IF NOT EXISTS idx_mail_threads_stale
  ON mail_threads (mailbox_id, queued_at DESC) WHERE stale;
CREATE INDEX IF NOT EXISTS idx_mail_threads_tenant
  ON mail_threads (tenant_id);
CREATE INDEX IF NOT EXISTS idx_mailboxes_tenant
  ON mailboxes (tenant_id);

-- Job chips: look up communications by Gmail thread id
CREATE INDEX IF NOT EXISTS idx_communications_tenant_thread
  ON communications (tenant_id, thread_id) WHERE thread_id IS NOT NULL;

ALTER TABLE mailboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_threads ENABLE ROW LEVEL SECURITY;

-- ── Permission: mail.view ──
-- user_permission_level (20261101_permission_rls.sql) again, with mail.view
-- added to the built-in defaults. Must match BUILT_IN_DEFAULTS in
-- lib/permissions/catalogue.ts (a test checks the newest definition).
CREATE OR REPLACE FUNCTION public.user_permission_level(p_action text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  v_role   text;
  v_level  text;
BEGIN
  IF v_uid IS NULL THEN RETURN 'blocked'; END IF;
  SELECT u.tenant_id, u.role INTO v_tenant, v_role FROM public.users u WHERE u.id = v_uid;
  IF v_tenant IS NULL THEN RETURN 'blocked'; END IF;
  IF v_role = 'admin' THEN RETURN 'allowed'; END IF;
  IF v_role IS NULL OR v_role NOT IN ('office', 'inspector') THEN v_role := 'inspector'; END IF;

  SELECT o.level INTO v_level FROM public.user_permission_overrides o
   WHERE o.tenant_id = v_tenant AND o.user_id = v_uid AND o.action = p_action;
  IF v_level IS NULL THEN
    SELECT d.level INTO v_level FROM public.permission_defaults d
     WHERE d.tenant_id = v_tenant AND d.role = v_role AND d.action = p_action;
  END IF;
  IF v_level IS NULL THEN
    SELECT b.level INTO v_level FROM (VALUES
      ('office', 'jobs.notes', 'allowed'),
      ('office', 'jobs.edit', 'allowed'),
      ('office', 'jobs.change_stage', 'allowed'),
      ('office', 'orders.lodge', 'allowed'),
      ('office', 'orders.manage', 'allowed'),
      ('office', 'records.delete', 'blocked'),
      ('office', 'mail.view', 'allowed'),
      ('office', 'send.work_orders', 'allowed'),
      ('office', 'send.documents', 'approval'),
      ('office', 'send.signing', 'approval'),
      ('office', 'send.replies', 'allowed'),
      ('office', 'financials.view', 'allowed'),
      ('office', 'invoices.manage', 'approval'),
      ('office', 'excess.decide', 'allowed'),
      ('office', 'settings.edit', 'blocked'),
      ('office', 'users.manage', 'blocked'),
      ('inspector', 'jobs.notes', 'allowed'),
      ('inspector', 'jobs.edit', 'allowed'),
      ('inspector', 'jobs.change_stage', 'blocked'),
      ('inspector', 'orders.lodge', 'blocked'),
      ('inspector', 'orders.manage', 'blocked'),
      ('inspector', 'records.delete', 'blocked'),
      ('inspector', 'mail.view', 'blocked'),
      ('inspector', 'send.work_orders', 'blocked'),
      ('inspector', 'send.documents', 'blocked'),
      ('inspector', 'send.signing', 'blocked'),
      ('inspector', 'send.replies', 'approval'),
      ('inspector', 'financials.view', 'blocked'),
      ('inspector', 'invoices.manage', 'blocked'),
      ('inspector', 'excess.decide', 'blocked'),
      ('inspector', 'settings.edit', 'blocked'),
      ('inspector', 'users.manage', 'blocked')
    ) AS b(role, action, level)
     WHERE b.role = v_role AND b.action = p_action;
  END IF;
  RETURN coalesce(v_level, 'blocked');
END
$$;
