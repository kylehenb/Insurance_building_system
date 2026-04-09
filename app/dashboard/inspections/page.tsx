import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/get-user";
import { createServiceClient } from "@/lib/supabase/server";
import AppLayout from "@/components/layout/app-layout";
import type { Database } from "@/lib/supabase/database.types";

type InspectionRow = Database["public"]["Tables"]["inspections"]["Row"];

type InspectionWithRelations = InspectionRow & {
  jobs: { job_number: string } | null;
  users: { name: string } | null;
};

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    unscheduled: "bg-gray-100 text-gray-700",
    urgent_awaiting_assignment: "bg-red-100 text-red-800",
    proposed: "bg-blue-100 text-blue-800",
    awaiting_reschedule: "bg-orange-100 text-orange-800",
    confirmed: "bg-green-100 text-green-800",
    in_progress: "bg-indigo-100 text-indigo-800",
    submitted: "bg-purple-100 text-purple-800",
    complete: "bg-gray-100 text-gray-800",
  };

  const labels: Record<string, string> = {
    unscheduled: "Unscheduled",
    urgent_awaiting_assignment: "Urgent — Awaiting Assignment",
    proposed: "Proposed",
    awaiting_reschedule: "Awaiting Reschedule",
    confirmed: "Confirmed",
    in_progress: "In Progress",
    submitted: "Submitted",
    complete: "Complete",
  };

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? "bg-gray-100 text-gray-700"}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

function SubStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-gray-100 text-gray-600",
    parsed: "bg-blue-50 text-blue-700",
    reviewed: "bg-green-50 text-green-700",
    draft: "bg-blue-50 text-blue-700",
    sent: "bg-green-50 text-green-700",
    uploaded: "bg-blue-50 text-blue-700",
    labelled: "bg-green-50 text-green-700",
  };

  const labels: Record<string, string> = {
    pending: "Pending",
    parsed: "Parsed",
    reviewed: "Reviewed",
    draft: "Draft",
    sent: "Sent",
    uploaded: "Uploaded",
    labelled: "Labelled",
  };

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? "bg-gray-100 text-gray-600"}`}
    >
      {labels[status] ?? status}
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

async function InspectionsListPage() {
  const userData = await getUser();

  if (!userData?.session) {
    redirect("/login");
  }

  if (!userData.user) {
    redirect("/auth/new-user");
  }

  const { tenant_id } = userData;

  const serviceClient = createServiceClient();
  const { data: inspections, error } = await serviceClient
    .from("inspections")
    .select(
      `id, inspection_ref, scheduled_date, status, scope_status, report_status, created_at,
       jobs!job_id(job_number),
       users!inspector_id(name)`
    )
    .eq("tenant_id", tenant_id as string)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching inspections:", error);
  }

  const typedInspections = (inspections as unknown as InspectionWithRelations[]) ?? [];

  return (
    <AppLayout>
      <div className="p-6 lg:p-8">
        <div className="mx-auto max-w-7xl">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-[#1a1a1a]">Inspections</h1>
              <p className="mt-1 text-sm text-[#1a1a1a]/60">
                All inspections across your jobs
              </p>
            </div>
          </div>

          {/* Table */}
          <div className="mt-8 rounded-lg border border-[#1a1a1a]/10 bg-white shadow-sm overflow-hidden">
            {typedInspections.length === 0 ? (
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
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                    />
                  </svg>
                </div>
                <h3 className="mt-4 text-lg font-medium text-[#1a1a1a]">No inspections yet</h3>
                <p className="mt-2 max-w-sm text-center text-sm text-[#1a1a1a]/60">
                  Inspections are created automatically when a new job is lodged.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[#1a1a1a]/10">
                  <thead className="bg-[#f5f0e8]/50">
                    <tr>
                      {[
                        "Inspection Ref",
                        "Job Number",
                        "Inspector",
                        "Scheduled Date",
                        "Status",
                        "Scope Status",
                        "Report Status",
                      ].map((heading) => (
                        <th
                          key={heading}
                          scope="col"
                          className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-[#1a1a1a]/60"
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1a1a1a]/10 bg-white">
                    {typedInspections.map((insp) => (
                      <tr key={insp.id} className="hover:bg-[#f5f0e8]/30 transition-colors">
                        <td className="whitespace-nowrap px-6 py-4">
                          <Link
                            href={`/dashboard/inspections/${insp.id}`}
                            className="text-sm font-medium text-[#1a1a1a] hover:underline"
                          >
                            {insp.inspection_ref ?? "-"}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <span className="text-sm text-[#1a1a1a]/70">
                            {insp.jobs?.job_number ?? "-"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <span className="text-sm text-[#1a1a1a]/70">
                            {insp.users?.name ?? "-"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <span className="text-sm text-[#1a1a1a]/70">
                            {formatDate(insp.scheduled_date)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <StatusBadge status={insp.status} />
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <SubStatusBadge status={insp.scope_status} />
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <SubStatusBadge status={insp.report_status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {typedInspections.length > 0 && (
            <div className="mt-4 text-sm text-[#1a1a1a]/60">
              Showing {typedInspections.length} inspection
              {typedInspections.length === 1 ? "" : "s"}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

export default InspectionsListPage;
