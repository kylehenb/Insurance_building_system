import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f5f0e8]">
      {/* Header */}
      <header className="border-b border-[#1a1a1a]/10 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-[#1a1a1a]">IRC Master</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-[#1a1a1a]/70">{user.email}</span>
            <form
              action="/api/auth/signout"
              method="post"
            >
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
            Welcome back! Your dashboard is under construction.
          </p>

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
