"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { User, Loader2, AlertCircle, CheckCircle } from "lucide-react";
import type { Database } from "@/lib/supabase/database.types";

type TenantRow = Database["public"]["Tables"]["tenants"]["Row"];
type TenantInsert = Database["public"]["Tables"]["tenants"]["Insert"];
type UserInsert = Database["public"]["Tables"]["users"]["Insert"];

export default function NewUserPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<{ id: string; email: string } | null>(null);

  const supabase = createClient();

  // Check if user already has a profile - if so, redirect to dashboard
  useEffect(() => {
    async function checkExistingUser() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
          router.push("/login");
          return;
        }

        setAuthUser({ id: user.id, email: user.email ?? "" });

        // Check if user already exists in public.users
        const { data: existingUser } = await supabase
          .from("users")
          .select("id")
          .eq("id", user.id)
          .single();

        if (existingUser) {
          // User already has a profile, redirect to dashboard
          router.push("/dashboard");
          return;
        }
      } catch {
        setError("Failed to check user status. Please try again.");
      } finally {
        setIsChecking(false);
      }
    }

    checkExistingUser();
  }, [router, supabase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    if (!authUser) {
      setError("No authenticated user found. Please sign in again.");
      setIsLoading(false);
      return;
    }

    if (!name.trim()) {
      setError("Please enter your full name.");
      setIsLoading(false);
      return;
    }

    try {
      // Create tenant first (this is the first user, so they become admin of their own tenant)
      const tenantData: TenantInsert = {
        name: `${name}'s Organization`,
        slug: `org-${authUser.id.slice(0, 8)}`,
        job_prefix: "IRC",
      };

      const { data: tenant, error: tenantError } = await (supabase
        .from("tenants") as any)
        .insert(tenantData)
        .select()
        .single();

      if (tenantError || !tenant) {
        setError("Failed to create organization. Please try again.");
        setIsLoading(false);
        return;
      }

      const typedTenant = tenant as TenantRow;

      // Create user profile with admin role
      const userData: UserInsert = {
        id: authUser.id,
        tenant_id: typedTenant.id,
        name: name.trim(),
        role: "admin", // First user is always admin
      };

      const { error: userError } = await (supabase.from("users") as any).insert(userData);

      if (userError) {
        setError("Failed to create user profile. Please try again.");
        setIsLoading(false);
        return;
      }

      // Success - redirect to dashboard
      router.push("/dashboard");
    } catch {
      setError("An unexpected error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  if (isChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f0e8] px-4">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#1a1a1a]" />
          <p className="mt-4 text-sm text-[#1a1a1a]/70">Checking your account...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f0e8] px-4">
      <div className="w-full max-w-md space-y-8 rounded-lg border border-[#1a1a1a]/10 bg-white p-8 shadow-sm">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#1a1a1a]">
            <User className="h-8 w-8 text-[#f5f0e8]" />
          </div>
          <h1 className="mt-6 text-2xl font-semibold text-[#1a1a1a]">
            Complete Your Setup
          </h1>
          <p className="mt-2 text-sm text-[#1a1a1a]/70">
            Welcome to IRC Master! Please enter your details to get started.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-[#1a1a1a]/60"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              disabled
              value={authUser?.email ?? ""}
              className="mt-2 block w-full rounded-md border border-[#1a1a1a]/10 bg-[#f5f0e8] px-4 py-3 text-[#1a1a1a]/60"
            />
          </div>

          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-[#1a1a1a]"
            >
              Full Name
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Smith"
              className="mt-2 block w-full rounded-md border border-[#1a1a1a]/20 bg-white px-4 py-3 text-[#1a1a1a] placeholder:text-[#1a1a1a]/40 focus:border-[#1a1a1a] focus:outline-none focus:ring-1 focus:ring-[#1a1a1a]"
            />
          </div>

          <div className="rounded-md bg-[#f5f0e8] p-4">
            <div className="flex items-start gap-3">
              <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#1a1a1a]/60" />
              <div>
                <p className="text-sm font-medium text-[#1a1a1a]">Admin Access</p>
                <p className="text-xs text-[#1a1a1a]/60 mt-1">
                  As the first user, you will be assigned the admin role with full permissions.
                </p>
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-red-600">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={isLoading || !name.trim()}
            className="w-full bg-[#1a1a1a] text-[#f5f0e8] hover:bg-[#1a1a1a]/90 disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Setting up...
              </>
            ) : (
              "Complete Setup"
            )}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-[#1a1a1a]/50">
          By completing setup, you agree to the terms of service.
        </p>
      </div>
    </div>
  );
}
