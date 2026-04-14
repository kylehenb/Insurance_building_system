'use client';

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";

type JobRow = Database["public"]["Tables"]["jobs"]["Row"];

function StatusBadge({ status }: { status: string }) {
  if (status === 'active')
    return <span style={{ background: '#eaf3f0', color: '#2a6b50', fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 4 }}>Active</span>
  if (status === 'on_hold')
    return <span style={{ background: '#fdf5e8', color: '#8a6020', fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 4 }}>On Hold</span>
  if (status === 'complete')
    return <span style={{ background: '#f3f4f6', color: '#6b7280', fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 4 }}>Complete</span>
  if (status === 'cancelled')
    return <span style={{ background: '#fdecea', color: '#b91c1c', fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 4 }}>Cancelled</span>
  return <span style={{ background: '#f3f4f6', color: '#6b7280', fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 4 }}>{status}</span>
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function JobsListPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Auth bootstrap
  useEffect(() => {
    async function bootstrap() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return }
      const { data: profile, error } = await supabase
        .from('users').select('tenant_id').eq('id', user.id).single();
      if (error || !profile) { router.push('/login'); return }
      setTenantId(profile.tenant_id);
    }
    bootstrap();
  }, [router, supabase]);

  useEffect(() => {
    if (!tenantId) return;
    async function fetchJobs() {
      const { data } = await supabase
        .from('jobs')
        .select('id, job_number, insured_name, property_address, insurer, status, created_at')
        .eq('tenant_id', tenantId!)
        .order('created_at', { ascending: false });
      setJobs((data as JobRow[]) ?? []);
      setLoading(false);
    }
    fetchJobs();
  }, [tenantId, supabase]);

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
          <div className="mt-8 rounded-lg border border-[#e4dfd8] bg-white shadow-sm overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="text-sm text-[#b0a898]">Loading...</div>
              </div>
            ) : jobs.length === 0 ? (
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
                <table className="min-w-full divide-y divide-[#f0ece6]">
                  <thead className="bg-[#fdfdfc]">
                    <tr>
                      <th
                        scope="col"
                        className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898]"
                      >
                        Job Number
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898]"
                      >
                        Insured Name
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898]"
                      >
                        Property Address
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898]"
                      >
                        Insurer
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898]"
                      >
                        Status
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898]"
                      >
                        Created
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f0ece6] bg-white">
                    {jobs.map((job: JobRow) => (
                      <tr
                        key={job.id}
                        onClick={() => router.push(`/dashboard/jobs/${job.id}`)}
                        className="hover:bg-[#faf9f7] transition-colors cursor-pointer"
                      >
                        <td className="whitespace-nowrap px-3 py-3">
                          <span className="text-xs font-medium text-[#c8b89a]">
                            {job.job_number}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-xs text-[#1a1a1a]">
                            {job.insured_name || "-"}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-xs text-[#1a1a1a]/70 max-w-xs truncate block">
                            {job.property_address || "-"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <span className="text-xs text-[#1a1a1a]/70">
                            {job.insurer || "-"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <StatusBadge status={job.status ?? 'active'} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <span className="text-xs text-[#b0a898]">
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
          {jobs.length > 0 && (
            <div className="mt-4 flex items-center justify-between text-sm text-[#1a1a1a]/60">
              <span>
                Showing {jobs.length} job{jobs.length === 1 ? "" : "s"}
              </span>
            </div>
          )}
        </div>
    </div>
  );
}
