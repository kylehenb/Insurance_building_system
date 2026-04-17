'use client';

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";

type WorkOrderRow = Database["public"]["Tables"]["work_orders"]["Row"];
type JobRow = Database["public"]["Tables"]["jobs"]["Row"];
type TradeRow = Database["public"]["Tables"]["trades"]["Row"];

interface WorkOrderWithDetails extends WorkOrderRow {
  job: JobRow | null;
  trade: TradeRow | null;
}

function WorkOrderStatusBadge({ status, garyState }: { status: string | null; garyState: string | null }) {
  const getStatusColor = () => {
    if (status === 'pending') return { bg: '#f5f2ee', color: '#9e998f' };
    if (status === 'engaged') return { bg: '#e8f5e9', color: '#2e7d32' };
    if (status === 'works_complete') return { bg: '#e3f2fd', color: '#1976d2' };
    if (status === 'invoice_received') return { bg: '#f3e5f5', color: '#7b1fa2' };
    return { bg: '#f5f2ee', color: '#9e998f' };
  };

  const { bg, color } = getStatusColor();

  return (
    <div className="flex items-center gap-2">
      <span
        style={{
          background: bg,
          color: color,
          fontSize: 11,
          fontWeight: 500,
          padding: '2px 7px',
          borderRadius: 4,
        }}
      >
        {status || 'Pending'}
      </span>
      {garyState && garyState !== 'not_started' && (
        <span
          style={{
            background: '#fff3e0',
            color: '#e65100',
            fontSize: 10,
          }}
          className="px-2 py-0.5 rounded"
        >
          Gary: {garyState}
        </span>
      )}
    </div>
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

export default function WorkOrdersPage() {
  const router = useRouter();
  const [workOrders, setWorkOrders] = useState<WorkOrderWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');

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
    async function fetchWorkOrders() {
      const { data } = await supabase
        .from('work_orders')
        .select(`
          *,
          job:jobs(job_number, insured_name, property_address),
          trade:trades(business_name, primary_trade)
        `)
        .eq('tenant_id', tenantId!)
        .order('created_at', { ascending: false });

      const formattedData = (data as any[])?.map(wo => ({
        ...wo,
        job: wo.job,
        trade: wo.trade,
      })) || [];
      setWorkOrders(formattedData);
      setLoading(false);
    }
    fetchWorkOrders();
  }, [tenantId, supabase]);

  const filteredWorkOrders = filterStatus === 'all' 
    ? workOrders 
    : workOrders.filter(wo => wo.status === filterStatus);

  return (
    <div className="p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[#1a1a1a]">Work Orders</h1>
            <p className="mt-1 text-sm text-[#1a1a1a]/60">
              Manage trade work orders and scheduling
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-6 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#1a1a1a]/60">Status:</span>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-md border border-[#e0dbd4] bg-white px-3 py-1.5 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c8b89a]"
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="engaged">Engaged</option>
              <option value="works_complete">Works Complete</option>
              <option value="invoice_received">Invoice Received</option>
            </select>
          </div>
        </div>

        {/* Work Orders Table */}
        <div className="mt-6 rounded-lg border border-[#e4dfd8] bg-white shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="text-sm text-[#b0a898]">Loading...</div>
            </div>
          ) : filteredWorkOrders.length === 0 ? (
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
                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                  />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-medium text-[#1a1a1a]">No work orders yet</h3>
              <p className="mt-2 max-w-sm text-center text-sm text-[#1a1a1a]/60">
                Work orders are automatically created when quotes are approved.
              </p>
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
                      Job
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898]"
                    >
                      Trade
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#b0a898]"
                    >
                      Work Type
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
                      Visits
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
                  {filteredWorkOrders.map((wo: WorkOrderWithDetails) => (
                    <tr
                      key={wo.id}
                      onClick={() => router.push(`/dashboard/jobs/${wo.job_id}?tab=trade-work-orders`)}
                      className="hover:bg-[#faf9f7] transition-colors cursor-pointer"
                    >
                      <td className="px-3 py-3">
                        <div>
                          <span className="text-xs font-medium text-[#c8b89a]">
                            {wo.job?.job_number || '-'}
                          </span>
                          {wo.job?.insured_name && (
                            <div className="text-xs text-[#1a1a1a]/70 mt-0.5">
                              {wo.job.insured_name}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div>
                          <span className="text-xs text-[#1a1a1a]">
                            {wo.trade?.business_name || '-'}
                          </span>
                          {wo.trade?.primary_trade && (
                            <div className="text-xs text-[#1a1a1a]/60 mt-0.5">
                              {wo.trade.primary_trade}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-xs text-[#1a1a1a]/70">
                          {wo.work_type || '-'}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <WorkOrderStatusBadge 
                          status={wo.status} 
                          garyState={wo.gary_state} 
                        />
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-xs text-[#1a1a1a]/70">
                          {wo.current_visit || 0} / {wo.total_visits || 1}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <span className="text-xs text-[#b0a898]">
                          {formatDate(wo.created_at)}
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
        {filteredWorkOrders.length > 0 && (
          <div className="mt-4 flex items-center justify-between text-sm text-[#1a1a1a]/60">
            <span>
              Showing {filteredWorkOrders.length} work order{filteredWorkOrders.length === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
