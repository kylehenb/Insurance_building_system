-- Database rules for the permissions the server can't check (lib/permissions).
--
-- Some edits go straight from the browser to Supabase (invoice editor,
-- settings pages, deleting records), so no API route sees them. These
-- restrictive policies apply the same permission levels in the database:
-- a write only goes through when the signed-in user's level for the action
-- is "allowed". ("Needs approval" can't be queued from the browser, so it
-- counts as not allowed here.) Restrictive policies AND with the existing
-- tenant-isolation policies; the service role (server routes, which check
-- permissions themselves) is unaffected.
--
-- Also: users can no longer write their own users row from the browser (it
-- let anyone change their own role, or create a row in any tenant), and
-- accounting credentials are visible only to people who may change settings.

-- ── The user's level for an action, as lib/permissions/resolve.ts works it out ──
-- Admin → allowed; else the person's own change → the company's default for
-- their role → the built-in default. Unknown roles count as inspector.
-- The built-in defaults below must match BUILT_IN_DEFAULTS in
-- lib/permissions/catalogue.ts (a test checks this file).
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

CREATE OR REPLACE FUNCTION public.user_can(p_action text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$ SELECT public.user_permission_level(p_action) = 'allowed' $$;

REVOKE ALL ON FUNCTION public.user_permission_level(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_can(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_permission_level(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_can(text) TO authenticated, service_role;

-- ── users: server-only writes ──
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.users FROM anon, authenticated;

-- ── Restrictive rules ──
-- One policy per table and command, named perm_<action>_<command>.
DO $$
DECLARE
  r record;
  cmd text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    -- Company settings
    ('settings.edit', 'tenants', 'UPDATE,DELETE'),
    ('settings.edit', 'automation_config', 'INSERT,UPDATE,DELETE'),
    ('settings.edit', 'auto_job_lodger_config', 'INSERT,UPDATE,DELETE'),
    ('settings.edit', 'client_email_config', 'INSERT,UPDATE,DELETE'),
    ('settings.edit', 'email_keyword_rules', 'INSERT,UPDATE,DELETE'),
    ('settings.edit', 'email_templates', 'INSERT,UPDATE,DELETE'),
    ('settings.edit', 'inspection_scheduling_rules', 'INSERT,UPDATE,DELETE'),
    ('settings.edit', 'invoice_templates', 'INSERT,UPDATE,DELETE'),
    ('settings.edit', 'invoice_line_item_library', 'INSERT,UPDATE,DELETE'),
    ('settings.edit', 'prompts', 'INSERT,UPDATE,DELETE'),
    ('settings.edit', 'quote_note_templates', 'INSERT,UPDATE,DELETE'),
    ('settings.edit', 'rate_config', 'INSERT,UPDATE,DELETE'),
    ('settings.edit', 'report_templates', 'INSERT,UPDATE,DELETE'),
    ('settings.edit', 'scope_library', 'INSERT,UPDATE,DELETE'),
    ('settings.edit', 'scope_library_overrides', 'INSERT,UPDATE,DELETE'),
    ('settings.edit', 'trade_type_sequence', 'INSERT,UPDATE,DELETE'),
    ('settings.edit', 'accounting_account_map', 'INSERT,UPDATE,DELETE'),
    ('settings.edit', 'accounting_credentials', 'SELECT,INSERT,UPDATE,DELETE'),
    -- Invoices
    ('invoices.manage', 'invoices', 'INSERT,UPDATE,DELETE'),
    ('invoices.manage', 'invoice_line_items', 'INSERT,UPDATE,DELETE'),
    ('invoices.manage', 'invoice_deductions', 'INSERT,UPDATE,DELETE'),
    -- Editing jobs, quotes, reports, work orders and contacts
    ('jobs.edit', 'jobs', 'INSERT,UPDATE'),
    ('jobs.edit', 'quotes', 'INSERT,UPDATE'),
    ('jobs.edit', 'reports', 'INSERT,UPDATE'),
    ('jobs.edit', 'scope_items', 'INSERT,UPDATE,DELETE'),
    ('jobs.edit', 'work_orders', 'INSERT,UPDATE'),
    ('jobs.edit', 'work_order_visits', 'INSERT,UPDATE,DELETE'),
    ('jobs.edit', 'clients', 'INSERT,UPDATE'),
    ('jobs.edit', 'trades', 'INSERT,UPDATE'),
    -- Deleting records
    ('records.delete', 'jobs', 'DELETE'),
    ('records.delete', 'quotes', 'DELETE'),
    ('records.delete', 'reports', 'DELETE'),
    ('records.delete', 'invoices', 'DELETE'),
    ('records.delete', 'work_orders', 'DELETE'),
    ('records.delete', 'insurer_orders', 'DELETE'),
    ('records.delete', 'communications', 'DELETE'),
    ('records.delete', 'clients', 'DELETE'),
    ('records.delete', 'trades', 'DELETE')
  ) AS t(action, tbl, cmds)
  LOOP
    FOREACH cmd IN ARRAY string_to_array(r.cmds, ',') LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'perm_' || r.action || '_' || lower(cmd), r.tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR %s TO authenticated %s',
        'perm_' || r.action || '_' || lower(cmd), r.tbl, cmd,
        CASE cmd
          WHEN 'INSERT' THEN format('WITH CHECK ((SELECT public.user_can(%L)))', r.action)
          WHEN 'UPDATE' THEN format('USING ((SELECT public.user_can(%L))) WITH CHECK ((SELECT public.user_can(%L)))', r.action, r.action)
          ELSE format('USING ((SELECT public.user_can(%L)))', r.action)
        END
      );
    END LOOP;
  END LOOP;
END
$$;
