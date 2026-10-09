import { type NextRequest, NextResponse, userAgent } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          supabaseResponse = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Public routes that don't require authentication
  const isPublicRoute =
    pathname === "/login" ||
    pathname === "/auth/callback" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/ai/") ||
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/api/gmail/");

  // Redirect unauthenticated users to login
  if (!user && !isPublicRoute) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from login
  if (user && pathname === "/login") {
    const dashboardUrl = new URL("/dashboard", request.url);
    return NextResponse.redirect(dashboardUrl);
  }

  // Phones opening an order link (e.g. from a notification email) get the
  // mobile review page. "?desktop=1" lets the user opt back into the full view.
  const openOrderId = request.nextUrl.searchParams.get("open");
  if (
    user &&
    pathname === "/dashboard/insurer-orders" &&
    openOrderId &&
    request.nextUrl.searchParams.get("desktop") !== "1" &&
    userAgent(request).device.type === "mobile"
  ) {
    const mobileUrl = new URL(
      `/m/insurer-orders/${encodeURIComponent(openOrderId)}`,
      request.url
    );
    const redirectResponse = NextResponse.redirect(mobileUrl);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });
    return redirectResponse;
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
