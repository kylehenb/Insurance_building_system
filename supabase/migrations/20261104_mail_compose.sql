-- Mail client phase 3: writing email (/dashboard/mail).
--
-- Every email being written is a real Gmail draft (so it shows in the Gmail
-- app too, and closing the page loses nothing). mail_drafts keeps what the
-- app needs to reopen one of its own drafts for editing: the text as typed
-- (the Gmail copy also has the signature and quoted email added), which
-- email it replies to or forwards, and its attachments. A draft started or
-- changed in the Gmail app has no row (or a stale gmail_message_id) and is
-- opened from Gmail as it is.
--
-- No RLS policies: only the server reads these, behind mail.view / mail.send.

CREATE TABLE IF NOT EXISTS mail_drafts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mailbox_id        UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  gmail_draft_id    TEXT NOT NULL,
  -- The draft's message id when the app last saved it; different = edited in Gmail
  gmail_message_id  TEXT,
  thread_id         TEXT,
  -- new | reply | reply_all | forward
  mode              TEXT NOT NULL DEFAULT 'new',
  -- Gmail id of the email replied to or forwarded (quoted below the text)
  quote_message_id  TEXT,
  -- The text as typed (rich HTML), without signature or quote
  body              TEXT NOT NULL DEFAULT '',
  include_signature BOOLEAN NOT NULL DEFAULT true,
  -- Quoted email kept as it was, for drafts started in the Gmail app
  raw_quote         TEXT,
  -- Threading headers when there's no quote_message_id to work them out from
  in_reply_to       TEXT,
  references_header TEXT,
  -- [{ kind: 'upload', path, filename, mimeType, size } | { kind: 'gmail', messageId, attachmentId, filename, mimeType, size }]
  attachments       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mailbox_id, gmail_draft_id)
);

CREATE INDEX IF NOT EXISTS idx_mail_drafts_tenant ON mail_drafts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_mail_drafts_created_by ON mail_drafts (created_by);

ALTER TABLE mail_drafts ENABLE ROW LEVEL SECURITY;

-- Files attached while writing, until the email is sent or discarded.
-- Private; uploaded with a signed upload URL from /api/mail/uploads.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('mail-attachments', 'mail-attachments', false, 26214400)
ON CONFLICT (id) DO NOTHING;

-- ── Permission: mail.send ──
-- user_permission_level again (last: 20261103_mail_organise_permission.sql)
-- with mail.send added. Must match BUILT_IN_DEFAULTS in
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
      ('office', 'mail.organise', 'allowed'),
      ('office', 'mail.send', 'allowed'),
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
      ('inspector', 'mail.organise', 'blocked'),
      ('inspector', 'mail.send', 'blocked'),
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
