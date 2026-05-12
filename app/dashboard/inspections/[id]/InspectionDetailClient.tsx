'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'
import { ArrowLeft, FileText, Smartphone, RefreshCw } from 'lucide-react'
import type { Database } from "@/lib/supabase/database.types";

type InspectionRow = Database["public"]["Tables"]["inspections"]["Row"];

type InspectionWithRelations = InspectionRow & {
  jobs: { id: string; job_number: string } | null;
  users: { name: string } | null;
};

interface InspectionDetailClientProps {
  initialInspection: InspectionWithRelations;
  tenantId: string;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    unscheduled: "bg-gray-100 text-gray-700",
    make_safe_awaiting_assignment: "bg-red-100 text-red-800",
    appointment_proposed: "bg-blue-100 text-blue-800",
    reschedule_required: "bg-orange-100 text-orange-800",
    appointment_confirmed: "bg-green-100 text-green-800",
    inspection_started: "bg-indigo-100 text-indigo-800",
    appointment_passed_not_started: "bg-yellow-100 text-yellow-800",
    review_and_send_all_docs: "bg-purple-100 text-purple-800",
    sent_and_locked: "bg-gray-100 text-gray-800",
  };

  const labels: Record<string, string> = {
    unscheduled: "Unscheduled",
    make_safe_awaiting_assignment: "Make Safe Awaiting Assignment",
    appointment_proposed: "Appointment Proposed",
    reschedule_required: "Reschedule Required",
    appointment_confirmed: "Appointment Confirmed",
    inspection_started: "Inspection Started",
    appointment_passed_not_started: "Appointment Passed, Inspection Not Started",
    review_and_send_all_docs: "Review and Send All Docs",
    sent_and_locked: "Sent and Locked",
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

function formatTime(timeString: string | null): string {
  if (!timeString) return "-";
  const [hours, minutes] = timeString.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
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

export default function InspectionDetailClient({ initialInspection, tenantId }: InspectionDetailClientProps) {
  const [inspection, setInspection] = useState<InspectionWithRelations>(initialInspection);
  const [refreshing, setRefreshing] = useState(false);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const checkMissedAppointment = async () => {
    // Check if this inspection should be marked as missed
    // Only check 'appointment_confirmed' status - exclude 'inspection_started'
    if (inspection.status === 'appointment_confirmed' && !inspection.safety_confirmed_at && inspection.scheduled_date && inspection.finish_time) {
      const scheduledDateTime = new Date(`${inspection.scheduled_date}T${inspection.finish_time || '23:59:59'}`);
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
      
      if (scheduledDateTime < fourHoursAgo) {
        try {
          const { error } = await supabase
            .from('inspections')
            .update({ status: 'appointment_passed_not_started' })
            .eq('id', inspection.id)
            .eq('tenant_id', tenantId);

          if (error) {
            console.error('Error updating missed appointment status:', error);
          } else {
            console.log('Updated inspection to missed appointment status');
            // Refresh to show updated status
            refreshInspection();
          }
        } catch (error) {
          console.error('Error checking missed appointment:', error);
        }
      }
    }
  };

  const refreshInspection = async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from("inspections")
        .select(
          `*,
           jobs!job_id(id, job_number),
           users!inspector_id(name)`
        )
        .eq("id", inspection.id)
        .eq("tenant_id", tenantId)
        .single();

      if (error) throw error;
      if (data) {
        setInspection(data as InspectionWithRelations);
      }
    } catch (error) {
      console.error('Error refreshing inspection:', error);
    } finally {
      setRefreshing(false);
    }
  };

  // Check for missed appointments on component load
  useEffect(() => {
    checkMissedAppointment();
  }, []);

  // Real-time subscription to inspection changes
  useEffect(() => {
    const channel = supabase
      .channel(`inspection-${inspection.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'inspections',
          filter: `id=eq.${inspection.id}`
        },
        (payload) => {
          console.log('Inspection updated:', payload);
          refreshInspection();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [inspection.id, supabase]);

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
                    {inspection.inspection_ref ?? "Inspection"}
                  </h1>
                  <StatusBadge status={inspection.status ?? 'unscheduled'} />
                  <button
                    onClick={refreshInspection}
                    disabled={refreshing}
                    className="inline-flex items-center gap-1 px-2 py-1 text-sm text-[#1a1a1a]/60 hover:text-[#1a1a1a] transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#1a1a1a]/70">

                  {inspection.jobs && (
                    <Link
                      href={`/dashboard/jobs/${inspection.jobs.id}`}
                      className="hover:underline font-medium"
                    >
                      {inspection.jobs.job_number}
                    </Link>
                  )}
                  {inspection.users?.name && (
                    <span>{inspection.users.name}</span>
                  )}
                  {inspection.scheduled_date && (
                    <span>{formatDate(inspection.scheduled_date)}</span>
                  )}
                </div>
              </div>
              {/* Open Field App */}
              <div>
                <a
                  href={`/field/${inspection.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] text-[#c8b89a] text-sm font-medium rounded-md hover:bg-[#252520] transition-colors"
                >
                  <Smartphone className="h-4 w-4" />
                  Open Field App
                </a>
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
                    <Field label="Inspection Ref" value={inspection.inspection_ref} />
                    <Field label="Scheduled Date" value={formatDate(inspection.scheduled_date)} />
                    <Field
                      label="Start Time"
                      value={formatTime(inspection.start_time)}
                    />
                    <Field
                      label="Finish Time"
                      value={formatTime(inspection.finish_time)}
                    />
                    <Field
                      label="Duration"
                      value={inspection.duration_minutes ? `${inspection.duration_minutes} minutes` : "-"}
                    />
                    <Field label="Inspector" value={inspection.users?.name ?? "-"} />
                    <Field
                      label="Status"
                      value={<StatusBadge status={inspection.status ?? 'unscheduled'} />}
                    />
                    <Field
                      label="Booking Confirmed"
                      value={formatDateTime(inspection.booking_confirmed_at)}
                    />
                    <Field
                      label="Insured Notified"
                      value={inspection.insured_notified ? "Yes" : "No"}
                    />
                    <Field
                      label="SMS Sent"
                      value={formatDateTime(inspection.scheduling_sms_sent_at)}
                    />
                    <Field
                      label="SMS Response"
                      value={inspection.scheduling_sms_response}
                    />
                    <Field label="Access Notes" value={inspection.access_notes ?? "-"} />
                  </dl>
                </div>

                {/* Field App */}
                <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
                  <h2 className="text-lg font-semibold text-[#1a1a1a] mb-4">Field App</h2>
                  <dl className="space-y-4">
                    <Field
                      label="Safety Confirmed"
                      value={formatDateTime(inspection.safety_confirmed_at)}
                    />
                    <Field
                      label="Form Submitted"
                      value={formatDateTime(inspection.form_submitted_at)}
                    />
                    <Field label="Person Met" value={inspection.person_met ?? "-"} />
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
                      value={<SubStatusBadge status={inspection.scope_status ?? 'pending'} />}
                    />
                    <Field
                      label="Report Status"
                      value={<SubStatusBadge status={inspection.report_status ?? 'pending'} />}
                    />
                    <Field
                      label="Photos Status"
                      value={<SubStatusBadge status={inspection.photos_status ?? 'pending'} />}
                    />
                  </dl>
                </div>

                {/* Notes */}
                <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
                  <h2 className="text-lg font-semibold text-[#1a1a1a] mb-4">Notes</h2>
                  <dl className="space-y-4">
                    <Field label="Job" value={inspection.jobs?.job_number ?? "-"} />
                    <Field label="Created" value={formatDateTime(inspection.created_at)} />
                    <Field
                      label="Notes"
                      value={
                        inspection.notes ? (
                          <span className="whitespace-pre-wrap">{inspection.notes}</span>
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
