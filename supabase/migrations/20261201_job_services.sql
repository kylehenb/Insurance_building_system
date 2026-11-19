-- Requested services: what the insurer asked for beyond the BAR — a make
-- safe, roof report, leak detection or specialist report — tracked on the job
-- until the insurer has the report and its invoice, whoever does the work.
-- Lodging creates one per type, not yet arranged; the office then does it
-- in-house (draft report and invoice at the client's rates) or sends it to a
-- trade (a work order; once the trade is done, the report and an invoice at
-- the trade's cost plus the builder's margin). See lib/jobs/services.ts.
CREATE TABLE IF NOT EXISTS job_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  insurer_order_id UUID REFERENCES insurer_orders(id) ON DELETE SET NULL,
  service_type TEXT NOT NULL CHECK (service_type IN ('make_safe', 'roof_report', 'leak_detection', 'specialist')),
  -- unassigned → in_house | trade → done; or cancelled (not needed)
  status TEXT NOT NULL DEFAULT 'unassigned' CHECK (status IN ('unassigned', 'in_house', 'trade', 'done', 'cancelled')),
  work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL,
  report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  notes TEXT,
  assigned_at TIMESTAMPTZ,
  assigned_by UUID,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_services_job_idx ON job_services (job_id);
CREATE INDEX IF NOT EXISTS job_services_open_idx ON job_services (tenant_id, status) WHERE status IN ('unassigned', 'in_house', 'trade');

-- Read in the browser (the job page and dashboard); changed only through the
-- API (services.manage), so the browser gets no write rules.
ALTER TABLE job_services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_read ON job_services;
CREATE POLICY tenant_read ON job_services FOR SELECT
  USING (tenant_id = (SELECT users.tenant_id FROM users WHERE users.id = (SELECT auth.uid())));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON job_services FROM anon, authenticated;

-- The new permissions "Arrange requested services" (services.manage) and
-- "Send a report without its invoice" (send.report_without_invoice).
-- user_permission_level again (last: 20261124_health_daily.sql).
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
      ('office', 'services.manage', 'allowed'),
      ('office', 'records.delete', 'blocked'),
      ('office', 'mail.view', 'allowed'),
      ('office', 'mail.organise', 'allowed'),
      ('office', 'mail.send', 'allowed'),
      ('office', 'actions.review', 'allowed'),
      ('office', 'send.work_orders', 'allowed'),
      ('office', 'send.documents', 'approval'),
      ('office', 'send.report_without_invoice', 'approval'),
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
      ('inspector', 'services.manage', 'blocked'),
      ('inspector', 'records.delete', 'blocked'),
      ('inspector', 'mail.view', 'blocked'),
      ('inspector', 'mail.organise', 'blocked'),
      ('inspector', 'mail.send', 'blocked'),
      ('inspector', 'actions.review', 'blocked'),
      ('inspector', 'send.work_orders', 'blocked'),
      ('inspector', 'send.documents', 'blocked'),
      ('inspector', 'send.report_without_invoice', 'blocked'),
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

