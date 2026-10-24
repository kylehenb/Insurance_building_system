-- Action cards: the AI's suggested next steps (tech spec §19, §23.11).
--
-- An incoming email (later texts, time rules) queues a card; Claude reads the
-- whole job file and the conversation and proposes steps — each a call to one
-- of the voice connector's tools (send_email, file_conversation, lodge_order…)
-- that is NOT run, only recorded. Confirm runs the chosen steps through the
-- same callTool path as the assistant: the user's permissions, approvals and
-- the who-did-what log apply.
--
-- status: queued → generating → pending (needs the user) | no_action (nothing
-- to do, e.g. a notification) | failed; pending → done | skipped | snoozed
-- (back to pending at snoozed_until). One live card per conversation: a new
-- email on it re-queues the same card.

ALTER TABLE action_queue ALTER COLUMN job_id DROP NOT NULL;

ALTER TABLE action_queue
  ADD COLUMN IF NOT EXISTS source            TEXT NOT NULL DEFAULT 'rule',
  -- email: the Gmail thread id
  ADD COLUMN IF NOT EXISTS source_ref        TEXT,
  -- The message the card was last made for
  ADD COLUMN IF NOT EXISTS trigger_ref       TEXT,
  -- [{ id, tool, args, summary, kind, result?, error?, ran_at? }]
  ADD COLUMN IF NOT EXISTS steps             JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reasoning         TEXT,
  ADD COLUMN IF NOT EXISTS model             TEXT,
  ADD COLUMN IF NOT EXISTS usage             JSONB,
  ADD COLUMN IF NOT EXISTS outcome           TEXT,
  ADD COLUMN IF NOT EXISTS attempts          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_action_queue_live_source
  ON action_queue (tenant_id, source, source_ref)
  WHERE source_ref IS NOT NULL AND status IN ('queued', 'generating', 'pending', 'snoozed', 'failed');
CREATE INDEX IF NOT EXISTS idx_action_queue_status ON action_queue (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_queue_queued ON action_queue (updated_at) WHERE status = 'queued';

-- ── Permission: actions.review ──
-- user_permission_level again (last: 20261104_mail_compose.sql) with
-- actions.review added. Must match BUILT_IN_DEFAULTS in
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
      ('office', 'actions.review', 'allowed'),
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
      ('inspector', 'actions.review', 'blocked'),
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
