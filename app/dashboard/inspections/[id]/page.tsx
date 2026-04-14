import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/get-user";
import { createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { ArrowLeft, FileText } from "lucide-react";

type InspectionRow = Database["public"]["Tables"]["inspections"]["Row"];

type InspectionWithRelations = InspectionRow & {
  jobs: { id: string; job_number: string } | null;
  users: { name: string } | null;
};

interface InspectionDetailPageProps {
  params: Promise<{ id: string }>;
}

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
      className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${styles[status] ?? "bg-gray-100 text-gray-700"}`}
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
    month: "long",
    year: "numeric",
  });
}

function formatDateTime(dateString: string | null): string {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const tabs = [
  { id: "details", label: "Details" },
  { id: "photos", label: "Photos" },
  { id: "safety", label: "Safety" },
  { id: "field-notes", label: "Field Notes" },
];

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <dt className="text-sm font-medium text-[#1a1a1a]/60">{label}</dt>
      <dd className="col-span-2 text-sm text-[#1a1a1a]">{value ?? "-"}</dd>
    </div>
  );
}

async function InspectionDetailPage({ params }: InspectionDetailPageProps) {
  const { id } = await params;

  const userData = await getUser();

  if (!userData?.session) {
    redirect("/login");
  }

  if (!userData.user) {
    redirect("/auth/new-user");
  }

  const { tenant_id } = userData;

  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from("inspections")
    .select(
      `*,
       jobs!job_id(id, job_number),
       users!inspector_id(name)`
    )
    .eq("id", id)
    .eq("tenant_id", tenant_id as string)
    .single();

  if (error || !data) {
    notFound();
  }

  const insp = data as unknown as InspectionWithRelations;

  return (
    <div className="min-h-screen bg-[#f5f0e8]">
        {/* Header Strip */}
        <div className="bg-white border-b border-[#1a1a1a]/10">
          <div className="px-6 lg:px-8 py-6">
            {/* Back link */}
            <Link
              href="/dashboard/inspections"
              className="inline-flex items-center gap-1 text-sm text-[#1a1a1a]/60 hover:text-[#1a1a1a] transition-colors mb-4"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Inspections
            </Link>

            {/* Inspection Header */}
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-[#1a1a1a]">
                    {insp.inspection_ref ?? "Inspection"}
                  </h1>
                  <StatusBadge status={insp.status ?? 'unscheduled'} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#1a1a1a]/70">
                  {insp.jobs && (
                    <Link
                      href={`/dashboard/jobs/${insp.jobs.id}`}
                      className="hover:underline font-medium"
                    >
                      {insp.jobs.job_number}
                    </Link>
                  )}
                  {insp.users?.name && (
                    <span>{insp.users.name}</span>
                  )}
                  {insp.scheduled_date && (
                    <span>{formatDate(insp.scheduled_date)}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Tab Bar */}
          <div className="px-6 lg:px-8 border-t border-[#1a1a1a]/10">
            <nav className="-mb-px flex gap-6 overflow-x-auto">
              {tabs.map((tab, i) => (
                <a
                  key={tab.id}
                  href={`#${tab.id}`}
                  className={`whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium transition-colors ${
                    i === 0
                      ? "border-[#1a1a1a] text-[#1a1a1a]"
                      : "border-transparent text-[#1a1a1a]/50 hover:text-[#1a1a1a] hover:border-[#1a1a1a]/30"
                  }`}
                >
                  {tab.label}
                </a>
              ))}
            </nav>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 lg:px-8 py-8">
          <div className="mx-auto max-w-6xl space-y-8">
            {/* Details Tab */}
            <section id="details">
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Scheduling */}
                <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
                  <h2 className="text-lg font-semibold text-[#1a1a1a] mb-4">Scheduling</h2>
                  <dl className="space-y-4">
                    <Field label="Inspection Ref" value={insp.inspection_ref} />
                    <Field label="Scheduled Date" value={formatDate(insp.scheduled_date)} />
                    <Field
                      label="Scheduled Time"
                      value={insp.scheduled_time ?? "-"}
                    />
                    <Field label="Inspector" value={insp.users?.name ?? "-"} />
                    <Field
                      label="Status"
                      value={<StatusBadge status={insp.status ?? 'unscheduled'} />}
                    />
                    <Field
                      label="Booking Confirmed"
                      value={formatDateTime(insp.booking_confirmed_at)}
                    />
                    <Field
                      label="Insured Notified"
                      value={insp.insured_notified ? "Yes" : "No"}
                    />
                    <Field
                      label="SMS Sent"
                      value={formatDateTime(insp.scheduling_sms_sent_at)}
                    />
                    <Field
                      label="SMS Response"
                      value={insp.scheduling_sms_response}
                    />
                    <Field label="Access Notes" value={insp.access_notes ?? "-"} />
                  </dl>
                </div>

                {/* Field App */}
                <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
                  <h2 className="text-lg font-semibold text-[#1a1a1a] mb-4">Field App</h2>
                  <dl className="space-y-4">
                    <Field
                      label="Safety Confirmed"
                      value={formatDateTime(insp.safety_confirmed_at)}
                    />
                    <Field
                      label="Form Submitted"
                      value={formatDateTime(insp.form_submitted_at)}
                    />
                    <Field label="Person Met" value={insp.person_met ?? "-"} />
                  </dl>
                </div>

                {/* Post-submission */}
                <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
                  <h2 className="text-lg font-semibold text-[#1a1a1a] mb-4">
                    Post-submission Status
                  </h2>
                  <dl className="space-y-4">
                    <Field
                      label="Scope Status"
                      value={<SubStatusBadge status={insp.scope_status ?? 'pending'} />}
                    />
                    <Field
                      label="Report Status"
                      value={<SubStatusBadge status={insp.report_status ?? 'pending'} />}
                    />
                    <Field
                      label="Photos Status"
                      value={<SubStatusBadge status={insp.photos_status ?? 'pending'} />}
                    />
                  </dl>
                </div>

                {/* Notes */}
                <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
                  <h2 className="text-lg font-semibold text-[#1a1a1a] mb-4">Notes</h2>
                  <dl className="space-y-4">
                    <Field label="Job" value={insp.jobs?.job_number ?? "-"} />
                    <Field label="Created" value={formatDateTime(insp.created_at)} />
                    <Field
                      label="Notes"
                      value={
                        insp.notes ? (
                          <span className="whitespace-pre-wrap">{insp.notes}</span>
                        ) : null
                      }
                    />
                  </dl>
                </div>
              </div>
            </section>

            {/* Coming soon tabs */}
            {tabs.slice(1).map((tab) => (
              <section key={tab.id} id={tab.id} className="scroll-mt-8">
                <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-12 shadow-sm">
                  <div className="text-center">
                    <FileText className="mx-auto h-12 w-12 text-[#1a1a1a]/20" />
                    <h3 className="mt-4 text-lg font-medium text-[#1a1a1a]">
                      {tab.label}
                    </h3>
                    <p className="mt-2 text-sm text-[#1a1a1a]/60">Coming soon</p>
                  </div>
                </div>
              </section>
            ))}
          </div>
        </div>
    </div>
  );
}

export default InspectionDetailPage;
