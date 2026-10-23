-- Permission: mail.organise — archive, bin, spam and read state on the Mail page.
-- user_permission_level again (last: 20261102_mailbox_mirror.sql) with
-- mail.organise added to the built-in defaults. Must match BUILT_IN_DEFAULTS
-- in lib/permissions/catalogue.ts (a test checks the newest definition).
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
