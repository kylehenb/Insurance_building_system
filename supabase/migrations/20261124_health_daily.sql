-- Health check, part 2 (tech spec §25.3): one row of figures per office per
-- day, rolled up into any week, month, quarter or year by the admin health
-- panel. Written by the nightly /api/health/daily, which also fills in the
-- past from records that carry dates. Server only (service role).

CREATE TABLE IF NOT EXISTS public.health_daily (
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  day         date NOT NULL,                -- Perth calendar day
  metrics     jsonb NOT NULL DEFAULT '{}',  -- key -> number; a missing key means "not tracked that day"
  version     integer NOT NULL DEFAULT 1,   -- recomputed when the metric list changes (lib/health/metrics.ts)
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, day)
);
ALTER TABLE public.health_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.health_daily FROM anon, authenticated;

-- Database and file storage size, for the limits part of the check
CREATE OR REPLACE FUNCTION public.health_storage_stats()
RETURNS TABLE (db_bytes bigint, storage_bytes bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_database_size(current_database())::bigint,
         coalesce((SELECT sum((o.metadata->>'size')::bigint) FROM storage.objects o), 0)::bigint
$$;
REVOKE ALL ON FUNCTION public.health_storage_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.health_storage_stats() TO service_role;

-- The new permission "See the health check" (health.view): admins only by
-- default. user_permission_level again (last: 20261107_action_cards.sql).
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
      ('office', 'health.view', 'blocked'),
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
      ('inspector', 'users.manage', 'blocked'),
      ('inspector', 'health.view', 'blocked')
    ) AS b(role, action, level)
     WHERE b.role = v_role AND b.action = p_action;
  END IF;
  RETURN coalesce(v_level, 'blocked');
END
$$;

