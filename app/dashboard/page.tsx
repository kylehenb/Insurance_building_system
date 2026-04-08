import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/get-user";

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

  const { user, tenant_id } = userData;

  return (
    <div className="flex min-h-screen flex-col bg-[#f5f0e8]">
      {/* Header */}
      <header className="border-b border-[#1a1a1a]/10 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-[#1a1a1a]">IRC Master</h1>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-[#1a1a1a]">{user.name}</p>
              <p className="text-xs text-[#1a1a1a]/60 capitalize">{user.role}</p>
            </div>
            <form action="/api/auth/signout" method="post">
              <button
                type="submit"
                className="text-sm text-[#1a1a1a]/60 hover:text-[#1a1a1a] underline"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-6">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-2xl font-semibold text-[#1a1a1a]">Dashboard</h2>
          <p className="mt-2 text-[#1a1a1a]/70">
            Welcome back, {user.name}! Your dashboard is under construction.
          </p>

          {/* User info card */}
          <div className="mt-6 rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-medium text-[#1a1a1a]">User Details</h3>
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
                <dd className="text-sm font-mono text-[#1a1a1a]">{tenant_id}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-[#1a1a1a]/60">User ID</dt>
                <dd className="text-sm font-mono text-[#1a1a1a]">{user.id}</dd>
              </div>
            </dl>
          </div>

          {/* Permission flags */}
          <div className="mt-6 rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-medium text-[#1a1a1a]">Permissions</h3>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="flex items-center justify-between">
                <dt className="text-sm text-[#1a1a1a]/60">Send to Insurer</dt>
                <dd className="text-sm">
                  {user.effectivePermissions.can_send_to_insurer ? (
                    <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
                      Yes
                    </span>
                  ) : (
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-800">
                      No
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-sm text-[#1a1a1a]/60">Edit Settings</dt>
                <dd className="text-sm">
                  {user.effectivePermissions.can_edit_settings ? (
                    <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
                      Yes
                    </span>
                  ) : (
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-800">
                      No
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-sm text-[#1a1a1a]/60">Approve Invoices</dt>
                <dd className="text-sm">
                  {user.effectivePermissions.can_approve_invoices ? (
                    <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
                      Yes
                    </span>
                  ) : (
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-800">
                      No
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-sm text-[#1a1a1a]/60">Manage Scope Library</dt>
                <dd className="text-sm">
                  {user.effectivePermissions.can_manage_scope_library ? (
                    <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
                      Yes
                    </span>
                  ) : (
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-800">
                      No
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-sm text-[#1a1a1a]/60">View Financials</dt>
                <dd className="text-sm">
                  {user.effectivePermissions.can_view_financials ? (
                    <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
                      Yes
                    </span>
                  ) : (
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-800">
                      No
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </div>

          {/* Placeholder cards */}
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-medium text-[#1a1a1a]">Jobs</h3>
              <p className="mt-2 text-sm text-[#1a1a1a]/60">
                View and manage insurance repair jobs
              </p>
            </div>
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
          </div>
        </div>
      </main>
    </div>
  );
}
