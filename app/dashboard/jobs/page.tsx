'use client';

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";
import { useAIActionRefresh } from "@/lib/hooks/useAIActionRefresh";
import { STAGE_CONFIG } from "@/lib/jobs/stageConfig";
import type { JobStageKey } from "@/lib/jobs/getJobStage";
import { useCurrentUser } from "@/components/layout/current-user";

type JobRow = {
  id: string
  job_number: string | null
  insured_name: string | null
  property_address: string | null
  insurer: string | null
  job_type: string | null
  override_stage: 'on_hold' | 'cancelled' | null
  current_stage: string | null
  created_at: string | null
}

type StageFilter =
  | 'all'
  | 'active'
  | 'awaiting_action'
  | 'waiting'
  | 'complete'
  | 'on_hold'
  | 'cancelled'

const STAGE_GROUPS: Record<Exclude<StageFilter, 'all'>, JobStageKey[]> = {
  active: [
    'awaiting_schedule',
    'inspection_scheduled',
    'awaiting_compilation',
    'sent_awaiting_approval',
    'approved_awaiting_signoff',
    'awaiting_signed_document',
    'signed_build_schedule',
    'repairs_in_progress',
    'awaiting_completion_signoff',
    'awaiting_trade_invoices',
    'ready_to_invoice',
  ],
  awaiting_action: [
    'order_received',
    'awaiting_schedule',
    'awaiting_compilation',
    'approved_awaiting_signoff',
    'signed_build_schedule',
    'awaiting_completion_signoff',
    'awaiting_trade_invoices',
    'ready_to_invoice',
  ],
  waiting: [
    'inspection_scheduled',
    'sent_awaiting_approval',
    'awaiting_signed_document',
    'repairs_in_progress',
    'invoiced_awaiting_payment',
  ],
  complete: ['complete'],
  on_hold: ['on_hold'],
  cancelled: ['cancelled'],
}

const FILTER_TABS: { key: StageFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'awaiting_action', label: 'Awaiting Action' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'complete', label: 'Complete' },
  { key: 'on_hold', label: 'On Hold' },
  { key: 'cancelled', label: 'Cancelled' },
]

function StagePill({ currentStage }: { currentStage: string | null }) {
  if (!currentStage) {
    return <span style={{ color: 'var(--faint)', fontSize: 11 }}>—</span>
  }
  const config = currentStage in STAGE_CONFIG
    ? STAGE_CONFIG[currentStage as JobStageKey]
    : null
  if (!config) {
    return <span style={{ color: 'var(--faint)', fontSize: 11 }}>{currentStage}</span>
  }
  const isOnHold = currentStage === 'on_hold'
  const isCancelled = currentStage === 'cancelled'
  const isComplete = currentStage === 'complete'
  const bgColor = isOnHold
    ? '#fdf5e8'
    : isCancelled
      ? '#fdecea'
      : isComplete
        ? '#f0fdf4'
        : '#f5f0e8'
  const textColor = isOnHold
    ? '#8a6020'
    : isCancelled
      ? '#b91c1c'
      : isComplete
        ? '#166534'
        : '#6a5a40'

  return (
    <span
      style={{
        background: bgColor,
        color: textColor,
        fontSize: 11,
        fontWeight: 500,
        padding: '2px 7px',
        borderRadius: 4,
        whiteSpace: 'nowrap',
      }}
    >
      {config.label}
    </span>
  )
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
  const { tenantId } = useCurrentUser();
  const [activeFilter, setActiveFilter] = useState<StageFilter>('all');

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const SELECT_FIELDS = 'id, job_number, insured_name, property_address, insurer, job_type, override_stage, current_stage, created_at'

  async function fetchJobs(tid: string, filter: StageFilter) {
    let query = supabase
      .from('jobs')
      .select(SELECT_FIELDS)
      .eq('tenant_id', tid)
      .neq('insurer', 'Midcity')
      .order('created_at', { ascending: false })

    if (filter !== 'all') {
      query = query.in('current_stage', STAGE_GROUPS[filter])
    }

    const { data } = await query
    setJobs((data as unknown as JobRow[]) ?? []);
    setLoading(false);
  }

  // Auth bootstrap

  useEffect(() => {
    if (!tenantId) return;
    fetchJobs(tenantId, activeFilter);
  }, [tenantId, activeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh when AI actions complete
  useAIActionRefresh(async () => {
    if (!tenantId) return;
    await fetchJobs(tenantId, activeFilter);
  }, [tenantId, activeFilter, supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-6 lg:p-8">
        <div className="mx-auto max-w-7xl">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-ink">Jobs</h1>
              <p className="mt-1 text-sm text-ink/60">
                Manage insurance repair jobs for your organization
              </p>
            </div>
            <Link
              href="/dashboard/jobs/new"
              className="inline-flex items-center justify-center rounded-lg bg-ink px-4 py-2 text-sm font-medium text-cream hover:bg-ink/90 transition-colors"
            >
              New Job
            </Link>
          </div>

          {/* Stage filter tabs */}
          <div className="mt-6 flex gap-1 border-b border-line-2">
            {FILTER_TABS.map((tab) => {
              const isActive = tab.key === activeFilter
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setLoading(true)
                    setActiveFilter(tab.key)
                  }}
                  style={{
                    padding: '7px 14px',
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? 'var(--ink)' : '#9e8060',
                    background: 'none',
                    border: 'none',
                    borderBottom: isActive ? '2px solid var(--gold)' : '2px solid transparent',
                    cursor: 'pointer',
                    marginBottom: -1,
                    fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* Jobs Table */}
          <div className="mt-4 rounded-lg border border-line-2 bg-white shadow-sm overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="text-sm text-faint">Loading...</div>
              </div>
            ) : jobs.length === 0 ? (
              /* Empty State */
              <div className="flex flex-col items-center justify-center py-16 px-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-cream">
                  <svg
                    className="h-8 w-8 text-ink/40"
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
                <h3 className="mt-4 text-lg font-medium text-ink">No jobs yet</h3>
                <p className="mt-2 max-w-sm text-center text-sm text-ink/60">
                  {activeFilter === 'all'
                    ? 'Get started by creating your first job. Jobs help you track insurance repair work from intake through completion.'
                    : 'No jobs match the selected filter.'}
                </p>
                {activeFilter === 'all' && (
                  <Link
                    href="/dashboard/jobs/new"
                    className="mt-6 inline-flex items-center justify-center rounded-lg bg-ink px-4 py-2 text-sm font-medium text-cream hover:bg-ink/90 transition-colors"
                  >
                    Create First Job
                  </Link>
                )}
              </div>
            ) : (
              /* Table */
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-line-faint">
                  <thead className="bg-surface-6">
                    <tr>
                      <th
                        scope="col"
                        className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-faint"
                      >
                        Job Number
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-faint"
                      >
                        Insured Name
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-faint"
                      >
                        Property Address
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-faint"
                      >
                        Insurer
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-faint"
                      >
                        Stage
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-faint"
                      >
                        Created
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-faint bg-white">
                    {jobs.map((job: JobRow) => (
                      <tr
                        key={job.id}
                        onClick={() => router.push(`/dashboard/jobs/${job.id}`)}
                        className="hover:bg-surface-3 transition-colors cursor-pointer"
                      >
                        <td className="whitespace-nowrap px-3 py-3">
                          <span className="text-xs font-medium text-tan">
                            {job.job_number}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-xs text-ink">
                            {job.insured_name || "-"}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-xs text-ink/70 max-w-xs truncate block">
                            {job.property_address || "-"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          {job.job_type === 'private' ? (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                padding: '2px 7px',
                                borderRadius: 4,
                                background: '#eef4ff',
                                color: '#3a5faa',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              Private
                            </span>
                          ) : (
                            <span className="text-xs text-ink/70">
                              {job.insurer || "-"}
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <StagePill currentStage={job.current_stage} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <span className="text-xs text-faint">
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
            <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
              <span>
                Showing {jobs.length} job{jobs.length === 1 ? "" : "s"}
              </span>
            </div>
          )}
        </div>
    </div>
  );
}
