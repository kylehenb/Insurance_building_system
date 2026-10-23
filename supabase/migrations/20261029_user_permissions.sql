-- User permissions (Settings → Users & Permissions). Additive only.
--
-- Each action (lib/permissions/catalogue.ts) has a level per user:
-- 'allowed' | 'approval' | 'blocked'. Built-in role defaults live in code;
-- these tables hold only the changes:
--   permission_defaults        a tenant's change to a role's default
--   user_permission_overrides  one user's change from their role
-- Users can read their own tenant's rows; all writes go through the server
-- (service role) after a users.manage check.
--
-- Explicit grants: from 30 Oct 2026 new public tables aren't exposed to the
-- Data API without them.

CREATE TABLE IF NOT EXISTS public.permission_defaults (
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('office', 'inspector')),
  action     text NOT NULL,
  level      text NOT NULL CHECK (level IN ('allowed', 'approval', 'blocked')),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, role, action)
);

CREATE TABLE IF NOT EXISTS public.user_permission_overrides (
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action     text NOT NULL,
  level      text NOT NULL CHECK (level IN ('allowed', 'approval', 'blocked')),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, action)
);

CREATE INDEX IF NOT EXISTS idx_user_permission_overrides_tenant ON public.user_permission_overrides (tenant_id);
CREATE INDEX IF NOT EXISTS idx_permission_defaults_updated_by ON public.permission_defaults (updated_by);
CREATE INDEX IF NOT EXISTS idx_user_permission_overrides_updated_by ON public.user_permission_overrides (updated_by);

ALTER TABLE public.permission_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS permission_defaults_tenant_read ON public.permission_defaults;
CREATE POLICY permission_defaults_tenant_read ON public.permission_defaults
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT users.tenant_id FROM public.users WHERE users.id = (SELECT auth.uid())));

DROP POLICY IF EXISTS user_permission_overrides_tenant_read ON public.user_permission_overrides;
CREATE POLICY user_permission_overrides_tenant_read ON public.user_permission_overrides
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT users.tenant_id FROM public.users WHERE users.id = (SELECT auth.uid())));

GRANT SELECT ON public.permission_defaults, public.user_permission_overrides TO authenticated;
GRANT ALL ON public.permission_defaults, public.user_permission_overrides TO service_role;
