import { cache } from "react";
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
 *
 * Cached per request: the layout and the page both call this, and only the
 * first call reaches Supabase.
 */
export const getUser = cache(async (): Promise<UserSession | null> => {
  const supabase = await createClient();

  // Verify the session token. With asymmetric JWT signing keys this is
  // checked locally; with the legacy shared secret it asks the Auth server.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (!claims?.sub) {
    return null;
  }

  const authUser = { id: claims.sub, email: claims.email };

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
});
