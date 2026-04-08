import type { Database } from "@/lib/supabase/database.types";

// User types based on the public.users table schema
export type UserRow = Database["public"]["Tables"]["users"]["Row"];
export type UserInsert = Database["public"]["Tables"]["users"]["Insert"];
export type UserUpdate = Database["public"]["Tables"]["users"]["Update"];

// Tenant types based on the public.tenants table schema
export type TenantRow = Database["public"]["Tables"]["tenants"]["Row"];
export type TenantInsert = Database["public"]["Tables"]["tenants"]["Insert"];
export type TenantUpdate = Database["public"]["Tables"]["tenants"]["Update"];

// User role types
export type UserRole = "admin" | "inspector" | "office";

// User with all permission flags (including effective permissions)
export interface User extends UserRow {
  // Effective permissions (computed from role defaults if null)
  effectivePermissions: {
    can_send_to_insurer: boolean;
    can_edit_settings: boolean;
    can_approve_invoices: boolean;
    can_manage_scope_library: boolean;
    can_view_financials: boolean;
  };
}

// Full user session response
export interface UserSession {
  session: {
    user: {
      id: string;
      email: string;
    };
  } | null;
  user: User | null;
  tenant_id: string | null;
}

// Role default permissions lookup
export const ROLE_DEFAULTS: Record<
  UserRole,
  {
    can_send_to_insurer: boolean;
    can_edit_settings: boolean;
    can_approve_invoices: boolean;
    can_manage_scope_library: boolean;
    can_view_financials: boolean;
  }
> = {
  admin: {
    can_send_to_insurer: true,
    can_edit_settings: true,
    can_approve_invoices: true,
    can_manage_scope_library: true,
    can_view_financials: true,
  },
  office: {
    can_send_to_insurer: true,
    can_edit_settings: false,
    can_approve_invoices: true,
    can_manage_scope_library: false,
    can_view_financials: true,
  },
  inspector: {
    can_send_to_insurer: false,
    can_edit_settings: false,
    can_approve_invoices: false,
    can_manage_scope_library: false,
    can_view_financials: false,
  },
};

// Helper to compute effective permissions from user row
export function computeEffectivePermissions(userRow: UserRow): User["effectivePermissions"] {
  const defaults = ROLE_DEFAULTS[userRow.role as UserRole] ?? ROLE_DEFAULTS.inspector;

  return {
    can_send_to_insurer:
      userRow.can_send_to_insurer ?? defaults.can_send_to_insurer,
    can_edit_settings:
      userRow.can_edit_settings ?? defaults.can_edit_settings,
    can_approve_invoices:
      userRow.can_approve_invoices ?? defaults.can_approve_invoices,
    can_manage_scope_library:
      userRow.can_manage_scope_library ?? defaults.can_manage_scope_library,
    can_view_financials:
      userRow.can_view_financials ?? defaults.can_view_financials,
  };
}

// Helper to convert UserRow to User with effective permissions
export function toUser(userRow: UserRow): User {
  return {
    ...userRow,
    effectivePermissions: computeEffectivePermissions(userRow),
  };
}
