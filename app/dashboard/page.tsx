import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/get-user";
import { AppLayout } from "@/components/layout/app-layout";

export default async function DashboardPage() {
  const userData = await getUser();

  // No session - redirect to login
  if (!userData?.session) {
    redirect("/login");
  }

  // Session exists but no user row in public.users - redirect to new-user setup
  if (!userData.user) {
    redirect("/auth/new-user");
  }

  const { user } = userData;

  return (
    <AppLayout>
      <div className="p-6 lg:p-8">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-2xl font-semibold text-[#1a1a1a]">Dashboard</h1>
          <p className="mt-2 text-[#1a1a1a]/70">
            Welcome back, {user.name}!
          </p>

          {/* Quick Actions */}
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Link
              href="/dashboard/jobs"
              className="rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
            >
              <h3 className="text-lg font-medium text-[#1a1a1a]">Jobs</h3>
              <p className="mt-2 text-sm text-[#1a1a1a]/60">
                View and manage insurance repair jobs
              </p>
            </Link>
            <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-medium text-[#1a1a1a]">Inspections</h3>
              <p className="mt-2 text-sm text-[#1a1a1a]/60">
                Schedule and review inspections
              </p>
            </div>
            <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-medium text-[#1a1a1a]">Reports</h3>
              <p className="mt-2 text-sm text-[#1a1a1a]/60">
                Generate and send reports
              </p>
            </div>
            <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-medium text-[#1a1a1a]">Quotes</h3>
              <p className="mt-2 text-sm text-[#1a1a1a]/60">
                Manage quotes and variations
              </p>
            </div>
          </div>

          {/* User info card */}
          <div className="mt-8 rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-medium text-[#1a1a1a]">Your Profile</h3>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-[#1a1a1a]/60">Name</dt>
                <dd className="text-sm text-[#1a1a1a]">{user.name}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-[#1a1a1a]/60">Role</dt>
                <dd className="text-sm capitalize text-[#1a1a1a]">{user.role}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-[#1a1a1a]/60">Tenant ID</dt>
                <dd className="text-sm font-mono text-[#1a1a1a]">{user.tenant_id}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
