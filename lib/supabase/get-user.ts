import { createClient, createServiceClient } from "@/lib/supabase/server";
import { toUser, type UserSession } from "@/lib/types/user";
import type { Database } from "./database.types";

type UserRow = Database["public"]["Tables"]["users"]["Row"];

/**
 * Server-side helper to get the current authenticated user with full profile data.
 * Returns { session, user, tenant_id } where user includes the full public.users row
 * with effective permissions computed.
 *
 * Returns null if no session exists.
 */
export async function getUser(): Promise<UserSession | null> {
  const supabase = await createClient();

  // Get the current auth session
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return null;
  }

  // Use service role to query public.users so that RLS cannot block a user
  // from reading their own profile row.
  const serviceClient = createServiceClient();
  const { data: userRow, error } = await serviceClient
    .from("users")
    .select("*")
    .eq("id", authUser.id)
    .single();

  if (error || !userRow) {
    // User exists in auth but not in public.users table
    // Return session but no user row - caller should redirect to new-user setup
    return {
      session: {
        user: {
          id: authUser.id,
          email: authUser.email ?? "",
        },
      },
      user: null,
      tenant_id: null,
    };
  }

  const typedUserRow = userRow as UserRow;

  return {
    session: {
      user: {
        id: authUser.id,
        email: authUser.email ?? "",
      },
    },
    user: toUser(typedUserRow),
    tenant_id: typedUserRow.tenant_id,
  };
}
