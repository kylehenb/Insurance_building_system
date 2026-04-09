import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/supabase/get-user";
import { createClient } from "@/lib/supabase/server";
import AppLayout from "@/components/layout/app-layout";
import type { Database } from "@/lib/supabase/database.types";
import {
  ArrowLeft,
  Calendar,
  MapPin,
  User,
  Building2,
  Phone,
  Mail,
  FileText,
} from "lucide-react";

type JobRow = Database["public"]["Tables"]["jobs"]["Row"];

interface JobDetailPageProps {
  params: Promise<{ id: string }>;
}

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
    <span className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${style}`}>
      {label}
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

function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return "-";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(amount);
}

const tabs = [
  { id: "summary", label: "Summary" },
  { id: "inspections", label: "Inspections" },
  { id: "reports", label: "Reports" },
  { id: "quotes", label: "Quotes" },
  { id: "work-orders", label: "Work Orders" },
  { id: "comms", label: "Comms" },
  { id: "invoices", label: "Invoices" },
  { id: "photos", label: "Photos" },
  { id: "notes", label: "Notes" },
];

async function JobDetailPage({ params }: JobDetailPageProps) {
  const { id } = await params;
  
  const userData = await getUser();

  if (!userData?.session) {
    redirect("/login");
  }

  if (!userData.user) {
    redirect("/auth/new-user");
  }

  const { tenant_id } = userData;

  // Fetch the specific job
  const supabase = await createClient();
  
  const result = await (supabase as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          single: () => Promise<{
            data: unknown | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  })
    .from("jobs")
    .select("*")
    .eq("id", id)
    .single();

  const { data: job, error } = result;

  // 404 if job not found, error occurred, or job belongs to different tenant
  if (error || !job) {
    notFound();
  }

  const typedJob = job as JobRow;
  
  // Additional tenant check (RLS should handle this, but defense in depth)
  if (typedJob.tenant_id !== tenant_id) {
    notFound();
  }

  return (
    <AppLayout>
      <div className="min-h-screen bg-[#f5f0e8]">
        {/* Header Strip */}
        <div className="bg-white border-b border-[#1a1a1a]/10">
          <div className="px-6 lg:px-8 py-6">
            {/* Back Link */}
            <Link
              href="/dashboard/jobs"
              className="inline-flex items-center gap-1 text-sm text-[#1a1a1a]/60 hover:text-[#1a1a1a] transition-colors mb-4"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Jobs
            </Link>

            {/* Job Header */}
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-[#1a1a1a]">
                    {typedJob.job_number}
                  </h1>
                  <StatusBadge status={typedJob.status} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#1a1a1a]/70">
                  {typedJob.insured_name && (
                    <span className="flex items-center gap-1">
                      <User className="h-4 w-4" />
                      {typedJob.insured_name}
                    </span>
                  )}
                  {typedJob.property_address && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-4 w-4" />
                      {typedJob.property_address}
                    </span>
                  )}
                  {typedJob.insurer && (
                    <span className="flex items-center gap-1">
                      <Building2 className="h-4 w-4" />
                      {typedJob.insurer}
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button className="inline-flex items-center justify-center rounded-lg border border-[#1a1a1a]/20 bg-white px-4 py-2 text-sm font-medium text-[#1a1a1a] hover:bg-[#f5f0e8] transition-colors">
                  Edit Job
                </button>
              </div>
            </div>
          </div>

          {/* Tab Bar */}
          <div className="px-6 lg:px-8 border-t border-[#1a1a1a]/10">
            <nav className="-mb-px flex gap-6 overflow-x-auto">
              {tabs.map((tab) => (
                <a
                  key={tab.id}
                  href={`#${tab.id}`}
                  className={`
                    whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium
                    border-[#1a1a1a] text-[#1a1a1a]
                  `}
                >
                  {tab.label}
                </a>
              ))}
            </nav>
          </div>
        </div>

        {/* Content Area */}
        <div className="px-6 lg:px-8 py-8">
          <div className="mx-auto max-w-6xl">
            {/* Summary Tab Content */}
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Left Column - Job Details */}
              <div className="space-y-6">
                {/* Basic Info */}
                <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
                  <h2 className="text-lg font-semibold text-[#1a1a1a] mb-4">
                    Job Details
                  </h2>
                  <dl className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <dt className="text-sm font-medium text-[#1a1a1a]/60">Claim Number</dt>
                      <dd className="col-span-2 text-sm text-[#1a1a1a]">
                        {typedJob.claim_number || "-"}
                      </dd>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <dt className="text-sm font-medium text-[#1a1a1a]/60">Date of Loss</dt>
                      <dd className="col-span-2 text-sm text-[#1a1a1a]">
                        {formatDate(typedJob.date_of_loss)}
                      </dd>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <dt className="text-sm font-medium text-[#1a1a1a]/60">Loss Type</dt>
                      <dd className="col-span-2 text-sm text-[#1a1a1a]">
                        {typedJob.loss_type || "-"}
                      </dd>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <dt className="text-sm font-medium text-[#1a1a1a]/60">Status</dt>
                      <dd className="col-span-2">
                        <StatusBadge status={typedJob.status} />
                      </dd>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <dt className="text-sm font-medium text-[#1a1a1a]/60">Created</dt>
                      <dd className="col-span-2 text-sm text-[#1a1a1a]">
                        {formatDate(typedJob.created_at)}
                      </dd>
                    </div>
                  </dl>
                </div>

                {/* Insured Details */}
                <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
                  <h2 className="text-lg font-semibold text-[#1a1a1a] mb-4">
                    Insured Details
                  </h2>
                  <dl className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <dt className="text-sm font-medium text-[#1a1a1a]/60">Name</dt>
                      <dd className="col-span-2 text-sm text-[#1a1a1a]">
                        {typedJob.insured_name || "-"}
                      </dd>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <dt className="text-sm font-medium text-[#1a1a1a]/60">Phone</dt>
                      <dd className="col-span-2 text-sm text-[#1a1a1a]">
                        {typedJob.insured_phone ? (
                          <a href={`tel:${typedJob.insured_phone}`} className="hover:underline">
                            {typedJob.insured_phone}
                          </a>
                        ) : (
                          "-"
                        )}
                      </dd>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <dt className="text-sm font-medium text-[#1a1a1a]/60">Email</dt>
                      <dd className="col-span-2 text-sm text-[#1a1a1a]">
                        {typedJob.insured_email ? (
                          <a href={`mailto:${typedJob.insured_email}`} className="hover:underline">
                            {typedJob.insured_email}
                          </a>
                        ) : (
                          "-"
                        )}
                      </dd>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <dt className="text-sm font-medium text-[#1a1a1a]/60">Address</dt>
                      <dd className="col-span-2 text-sm text-[#1a1a1a]">
                        {typedJob.property_address || "-"}
                      </dd>
                    </div>
                  </dl>
                </div>

                {/* Claim Description */}
                {typedJob.claim_description && (
                  <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
                    <h2 className="text-lg font-semibold text-[#1a1a1a] mb-4">
                      Claim Description
                    </h2>
                    <p className="text-sm text-[#1a1a1a]/80 whitespace-pre-wrap">
                      {typedJob.claim_description}
                    </p>
                  </div>
                )}
              </div>

              {/* Right Column - Insurer & Financial */}
              <div className="space-y-6">
                {/* Insurer Info */}
                <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
                  <h2 className="text-lg font-semibold text-[#1a1a1a] mb-4">
                    Insurer Information
                  </h2>
                  <dl className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <dt className="text-sm font-medium text-[#1a1a1a]/60">Insurer</dt>
                      <dd className="col-span-2 text-sm text-[#1a1a1a]">
                        {typedJob.insurer || "-"}
                      </dd>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <dt className="text-sm font-medium text-[#1a1a1a]/60">Adjuster</dt>
                      <dd className="col-span-2 text-sm text-[#1a1a1a]">
                        {typedJob.adjuster || "-"}
                      </dd>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <dt className="text-sm font-medium text-[#1a1a1a]/60">Claim #</dt>
                      <dd className="col-span-2 text-sm text-[#1a1a1a]">
                        {typedJob.claim_number || "-"}
                      </dd>
                    </div>
                  </dl>
                </div>

                {/* Financial Details */}
                <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
                  <h2 className="text-lg font-semibold text-[#1a1a1a] mb-4">
                    Financial Details
                  </h2>
                  <dl className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <dt className="text-sm font-medium text-[#1a1a1a]/60">Sum Insured</dt>
                      <dd className="col-span-2 text-sm text-[#1a1a1a]">
                        {formatCurrency(typedJob.sum_insured)}
                      </dd>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <dt className="text-sm font-medium text-[#1a1a1a]/60">Excess</dt>
                      <dd className="col-span-2 text-sm text-[#1a1a1a]">
                        {formatCurrency(typedJob.excess)}
                      </dd>
                    </div>
                  </dl>
                </div>

                {/* Special Instructions */}
                {typedJob.special_instructions && (
                  <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
                    <h2 className="text-lg font-semibold text-[#1a1a1a] mb-4">
                      Special Instructions
                    </h2>
                    <p className="text-sm text-[#1a1a1a]/80 whitespace-pre-wrap">
                      {typedJob.special_instructions}
                    </p>
                  </div>
                )}

                {/* Additional Contacts */}
                {typedJob.additional_contacts && (
                  <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
                    <h2 className="text-lg font-semibold text-[#1a1a1a] mb-4">
                      Additional Contacts
                    </h2>
                    <p className="text-sm text-[#1a1a1a]/80 whitespace-pre-wrap">
                      {typedJob.additional_contacts}
                    </p>
                  </div>
                )}

                {/* Notes */}
                {typedJob.notes && (
                  <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
                    <h2 className="text-lg font-semibold text-[#1a1a1a] mb-4">
                      Notes
                    </h2>
                    <p className="text-sm text-[#1a1a1a]/80 whitespace-pre-wrap">
                      {typedJob.notes}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Coming Soon placeholders for other tabs */}
            <div className="mt-12 space-y-8">
              {tabs.slice(1).map((tab) => (
                <section key={tab.id} id={tab.id} className="scroll-mt-8">
                  <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-12 shadow-sm">
                    <div className="text-center">
                      <FileText className="mx-auto h-12 w-12 text-[#1a1a1a]/20" />
                      <h3 className="mt-4 text-lg font-medium text-[#1a1a1a]">
                        {tab.label}
                      </h3>
                      <p className="mt-2 text-sm text-[#1a1a1a]/60">
                        Coming soon
                      </p>
                    </div>
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

export default JobDetailPage;
