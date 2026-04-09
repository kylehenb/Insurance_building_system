import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/get-user";
import { createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type JobRow = Database["public"]["Tables"]["jobs"]["Row"];

function StatusBadge({ status }: { status: string }) {
  const styles = {
    active: "bg-green-100 text-green-800",
    on_hold: "bg-yellow-100 text-yellow-800",
    complete: "bg-gray-100 text-gray-800",
    cancelled: "bg-red-100 text-red-800",
  };

  const labels = {
    active: "Active",
    on_hold: "On Hold",
    complete: "Complete",
    cancelled: "Cancelled",
  };

  const style = styles[status as keyof typeof styles] || "bg-gray-100 text-gray-800";
  const label = labels[status as keyof typeof labels] || status;

  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

async function JobsListPage() {
  const userData = await getUser();

  if (!userData?.session) {
    redirect("/login");
  }

  if (!userData.user) {
    redirect("/auth/new-user");
  }

  const { tenant_id } = userData;

  // Fetch jobs for this tenant using service role to bypass RLS
  const serviceClient = createServiceClient();
  const { data: jobs, error } = await serviceClient
    .from("jobs")
    .select("id, job_number, insured_name, property_address, insurer, status, created_at")
    .eq("tenant_id", tenant_id as string)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching jobs:", error);
  }

  const typedJobs = (jobs as JobRow[]) || [];

  return (
    <div className="p-6 lg:p-8">
        <div className="mx-auto max-w-7xl">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-[#1a1a1a]">Jobs</h1>
              <p className="mt-1 text-sm text-[#1a1a1a]/60">
                Manage insurance repair jobs for your organization
              </p>
            </div>
            <Link
              href="/dashboard/jobs/new"
              className="inline-flex items-center justify-center rounded-lg bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-[#f5f0e8] hover:bg-[#1a1a1a]/90 transition-colors"
            >
              New Job
            </Link>
          </div>

          {/* Jobs Table */}
          <div className="mt-8 rounded-lg border border-[#1a1a1a]/10 bg-white shadow-sm overflow-hidden">
            {typedJobs.length === 0 ? (
              /* Empty State */
              <div className="flex flex-col items-center justify-center py-16 px-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#f5f0e8]">
                  <svg
                    className="h-8 w-8 text-[#1a1a1a]/40"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 12h.01M15 12h.01M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2s10 4.477 10 10z"
                    />
                  </svg>
                </div>
                <h3 className="mt-4 text-lg font-medium text-[#1a1a1a]">No jobs yet</h3>
                <p className="mt-2 max-w-sm text-center text-sm text-[#1a1a1a]/60">
                  Get started by creating your first job. Jobs help you track insurance
                  repair work from intake through completion.
                </p>
                <Link
                  href="/dashboard/jobs/new"
                  className="mt-6 inline-flex items-center justify-center rounded-lg bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-[#f5f0e8] hover:bg-[#1a1a1a]/90 transition-colors"
                >
                  Create First Job
                </Link>
              </div>
            ) : (
              /* Table */
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[#1a1a1a]/10">
                  <thead className="bg-[#f5f0e8]/50">
                    <tr>
                      <th
                        scope="col"
                        className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-[#1a1a1a]/60"
                      >
                        Job Number
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-[#1a1a1a]/60"
                      >
                        Insured Name
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-[#1a1a1a]/60"
                      >
                        Property Address
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-[#1a1a1a]/60"
                      >
                        Insurer
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-[#1a1a1a]/60"
                      >
                        Status
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-[#1a1a1a]/60"
                      >
                        Created
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1a1a1a]/10 bg-white">
                    {typedJobs.map((job) => (
                      <tr
                        key={job.id}
                        className="hover:bg-[#f5f0e8]/30 transition-colors"
                      >
                        <td className="whitespace-nowrap px-6 py-4">
                          <Link
                            href={`/dashboard/jobs/${job.id}`}
                            className="text-sm font-medium text-[#1a1a1a] hover:underline"
                          >
                            {job.job_number}
                          </Link>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-[#1a1a1a]">
                            {job.insured_name || "-"}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-[#1a1a1a]/70 max-w-xs truncate block">
                            {job.property_address || "-"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <span className="text-sm text-[#1a1a1a]/70">
                            {job.insurer || "-"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <StatusBadge status={job.status} />
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <span className="text-sm text-[#1a1a1a]/60">
                            {formatDate(job.created_at)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Summary */}
          {typedJobs.length > 0 && (
            <div className="mt-4 flex items-center justify-between text-sm text-[#1a1a1a]/60">
              <span>
                Showing {typedJobs.length} job{typedJobs.length === 1 ? "" : "s"}
              </span>
            </div>
          )}
        </div>
    </div>
  );
}

export default JobsListPage;
