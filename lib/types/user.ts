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

// A signed-in user's profile. What they may do comes from lib/permissions
// (loadUserPermissions), not from this row — the old can_* columns on users
// are no longer read.
export type User = UserRow;

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

// The profile row as the session's user
export function toUser(userRow: UserRow): User {
  return userRow;
}
