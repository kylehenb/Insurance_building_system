import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data?.user) {
      // Check if user exists in public.users table
      const { data: userRow, error: userError } = await supabase
        .from("users")
        .select("id")
        .eq("id", data.user.id)
        .single();

      // If user doesn't exist in public.users, redirect to new-user setup
      if (userError || !userRow) {
        return NextResponse.redirect(`${origin}/auth/new-user`);
      }

      return NextResponse.redirect(`${origin}${next}`);
    }

    console.error("Auth callback error:", error);
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`);
}
