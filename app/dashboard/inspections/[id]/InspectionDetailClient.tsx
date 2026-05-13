'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'
import { ArrowLeft, FileText, Smartphone, RefreshCw, Calendar, CheckCircle, Clock, RotateCcw } from 'lucide-react'
import type { Database } from "@/lib/supabase/database.types";

type InspectionRow = Database["public"]["Tables"]["inspections"]["Row"];

type InspectionWithRelations = InspectionRow & {
  jobs: { id: string; job_number: string; property_address: string | null; insured_name: string | null; insured_phone: string | null } | null;
  users: { name: string } | null;
};

interface InspectionDetailClientProps {
  initialInspection: InspectionWithRelations;
  tenantId: string;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    unscheduled: "bg-gray-100 text-gray-700",
    reschedule_required: "bg-orange-100 text-orange-800",
    make_safe_awaiting_assignment: "bg-red-100 text-red-800",
    appointment_proposed: "bg-blue-100 text-blue-800",
    appointment_confirmed: "bg-green-100 text-green-800",
    inspection_started: "bg-indigo-100 text-indigo-800",
    appointment_passed_not_started: "bg-yellow-100 text-yellow-800",
    review_and_send_all_docs: "bg-purple-100 text-purple-800",
    sent_and_locked: "bg-gray-100 text-gray-800",
  };

  const labels: Record<string, string> = {
    unscheduled: "Unscheduled",
    reschedule_required: "Reschedule Required",
    make_safe_awaiting_assignment: "Make Safe Awaiting Assignment",
    appointment_proposed: "Appointment Proposed",
    appointment_confirmed: "Appointment Confirmed",
    inspection_started: "Inspection Started",
    appointment_passed_not_started: "Appointment Passed, Inspection Not Started",
    review_and_send_all_docs: "Review and Send All Docs",
    sent_and_locked: "Sent and Locked",
  };

  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${styles[status] ?? "bg-gray-100 text-gray-700"}`}>
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
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? "bg-gray-100 text-gray-600"}`}>
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

const SCHEDULABLE_STATUSES = ['unscheduled', 'reschedule_required', 'appointment_proposed', 'appointment_confirmed'];

export default function InspectionDetailClient({ initialInspection, tenantId }: InspectionDetailClientProps) {
  const [inspection, setInspection] = useState<InspectionWithRelations>(initialInspection);
  const [refreshing, setRefreshing] = useState(false);

  // Scheduling edit state
  const [scheduledDate, setScheduledDate] = useState(inspection.scheduled_date ?? '');
  const [startTime, setStartTime] = useState(inspection.start_time ?? '');
  const [finishTime, setFinishTime] = useState(inspection.finish_time ?? '');

  // Action loading states
  const [proposing, setProposing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [followingUp, setFollowingUp] = useState(false);

  // Feedback messages
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Sync local date/time state when inspection refreshes
  useEffect(() => {
    setScheduledDate(inspection.scheduled_date ?? '');
    setStartTime(inspection.start_time ?? '');
    setFinishTime(inspection.finish_time ?? '');
  }, [inspection.scheduled_date, inspection.start_time, inspection.finish_time]);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setActionMessage({ type, text });
    setTimeout(() => setActionMessage(null), 4000);
  };

  const checkMissedAppointment = async () => {
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

          if (!error) refreshInspection();
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
           jobs!job_id(id, job_number, property_address, insured_name, insured_phone),
           users!inspector_id(name)`
        )
        .eq("id", inspection.id)
        .eq("tenant_id", tenantId)
        .single();

      if (error) throw error;
      if (data) setInspection(data as InspectionWithRelations);
    } catch (error) {
      console.error('Error refreshing inspection:', error);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => { checkMissedAppointment(); }, []);

  useEffect(() => {
    const channel = supabase
      .channel(`inspection-${inspection.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'inspections',
        filter: `id=eq.${inspection.id}`,
      }, () => { refreshInspection(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [inspection.id]);

  // ── Action handlers ──────────────────────────────────────────────────────

  const handlePropose = async () => {
    if (!scheduledDate || !startTime || !finishTime) {
      showMessage('error', 'Please set a date, start time, and finish time before proposing.');
      return;
    }
    setProposing(true);
    try {
      const res = await fetch(`/api/inspections/${inspection.id}/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledDate, startTime, finishTime }),
      });
      const data = await res.json();
      if (!res.ok) {
        showMessage('error', data.error ?? 'Failed to propose appointment.');
      } else {
        const calNote = data.calendarCreated ? ' Calendar event created.' : ' (Calendar not configured — add GOOGLE_CALENDAR_* env vars.)';
        showMessage('success', `Appointment proposed. SMS mock sent.${calNote}`);
        await refreshInspection();
      }
    } catch {
      showMessage('error', 'Network error. Please try again.');
    } finally {
      setProposing(false);
    }
  };

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      const res = await fetch(`/api/inspections/${inspection.id}/confirm`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        showMessage('error', data.error ?? 'Failed to confirm appointment.');
      } else {
        showMessage('success', 'Appointment confirmed.');
        await refreshInspection();
      }
    } catch {
      showMessage('error', 'Network error. Please try again.');
    } finally {
      setConfirming(false);
    }
  };

  const handleFollowUp = async () => {
    setFollowingUp(true);
    // Mock action — logs intent, will send follow-up SMS in future
    await new Promise(r => setTimeout(r, 600));
    console.log(`[follow-up] MOCK: Follow up on inspection ${inspection.inspection_ref}`);
    showMessage('success', 'Follow-up logged. (SMS will be wired up in a future release.)');
    setFollowingUp(false);
  };

  const handleReschedule = async () => {
    setRescheduling(true);
    try {
      const res = await fetch(`/api/inspections/${inspection.id}/reschedule`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        showMessage('error', data.error ?? 'Failed to mark for reschedule.');
      } else {
        showMessage('success', 'Marked as reschedule required. Calendar event removed.');
        await refreshInspection();
      }
    } catch {
      showMessage('error', 'Network error. Please try again.');
    } finally {
      setRescheduling(false);
    }
  };

  const isSchedulable = SCHEDULABLE_STATUSES.includes(inspection.status ?? '');
  const status = inspection.status ?? 'unscheduled';

  return (
    <div className="min-h-screen bg-[#f5f0e8]">
      {/* Header Strip */}
      <div className="bg-white border-b border-[#1a1a1a]/10">
        <div className="px-6 lg:px-8 py-6">
          <Link
            href="/dashboard/inspections"
            className="inline-flex items-center gap-1 text-sm text-[#1a1a1a]/60 hover:text-[#1a1a1a] transition-colors mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Inspections
          </Link>

          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-[#1a1a1a]">
                  {inspection.inspection_ref ?? "Inspection"}
                </h1>
                <StatusBadge status={status} />
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
                  <Link href={`/dashboard/jobs/${inspection.jobs.id}`} className="hover:underline font-medium">
                    {inspection.jobs.job_number}
                  </Link>
                )}
                {inspection.users?.name && <span>{inspection.users.name}</span>}
                {inspection.jobs?.property_address && <span>{inspection.jobs.property_address}</span>}
              </div>
            </div>
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

          {/* Feedback message */}
          {actionMessage && (
            <div className={`rounded-lg px-4 py-3 text-sm font-medium ${
              actionMessage.type === 'success'
                ? 'bg-green-50 text-green-800 border border-green-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}>
              {actionMessage.text}
            </div>
          )}

          <section id="details">
            <div className="grid gap-6 lg:grid-cols-2">

              {/* Scheduling Card */}
              <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-[#1a1a1a] mb-4">Scheduling</h2>
                <dl className="space-y-4">
                  <Field label="Inspection Ref" value={inspection.inspection_ref} />

                  {/* Editable date/time — only for schedulable statuses */}
                  {isSchedulable ? (
                    <>
                      <div className="grid grid-cols-3 gap-4 items-center">
                        <dt className="text-sm font-medium text-[#1a1a1a]/60">Scheduled Date</dt>
                        <dd className="col-span-2">
                          <input
                            type="date"
                            value={scheduledDate}
                            onChange={e => setScheduledDate(e.target.value)}
                            className="w-full rounded-md border border-[#1a1a1a]/20 px-3 py-1.5 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#1a1a1a]/20"
                          />
                        </dd>
                      </div>
                      <div className="grid grid-cols-3 gap-4 items-center">
                        <dt className="text-sm font-medium text-[#1a1a1a]/60">Start Time</dt>
                        <dd className="col-span-2">
                          <input
                            type="time"
                            value={startTime}
                            onChange={e => setStartTime(e.target.value)}
                            className="w-full rounded-md border border-[#1a1a1a]/20 px-3 py-1.5 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#1a1a1a]/20"
                          />
                        </dd>
                      </div>
                      <div className="grid grid-cols-3 gap-4 items-center">
                        <dt className="text-sm font-medium text-[#1a1a1a]/60">Finish Time</dt>
                        <dd className="col-span-2">
                          <input
                            type="time"
                            value={finishTime}
                            onChange={e => setFinishTime(e.target.value)}
                            className="w-full rounded-md border border-[#1a1a1a]/20 px-3 py-1.5 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#1a1a1a]/20"
                          />
                        </dd>
                      </div>
                    </>
                  ) : (
                    <>
                      <Field label="Scheduled Date" value={formatDate(inspection.scheduled_date)} />
                      <Field label="Start Time" value={formatTime(inspection.start_time)} />
                      <Field label="Finish Time" value={formatTime(inspection.finish_time)} />
                    </>
                  )}

                  <Field
                    label="Duration"
                    value={inspection.duration_minutes ? `${inspection.duration_minutes} minutes` : "-"}
                  />
                  <Field label="Inspector" value={inspection.users?.name ?? "-"} />
                  <Field label="Status" value={<StatusBadge status={status} />} />
                  <Field label="Booking Confirmed" value={formatDateTime(inspection.booking_confirmed_at)} />
                  <Field label="Insured Notified" value={inspection.insured_notified ? "Yes" : "No"} />
                  <Field label="SMS Sent" value={formatDateTime(inspection.scheduling_sms_sent_at)} />
                  <Field label="SMS Response" value={inspection.scheduling_sms_response} />
                  <Field label="Access Notes" value={inspection.access_notes ?? "-"} />
                </dl>

                {/* Action buttons */}
                <div className="mt-6 pt-5 border-t border-[#1a1a1a]/10">
                  {(status === 'unscheduled' || status === 'reschedule_required') && (
                    <button
                      onClick={handlePropose}
                      disabled={proposing}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] text-[#c8b89a] text-sm font-medium rounded-md hover:bg-[#252520] transition-colors disabled:opacity-50"
                    >
                      <Calendar className="h-4 w-4" />
                      {proposing ? 'Proposing…' : 'Propose Appointment'}
                    </button>
                  )}

                  {status === 'appointment_proposed' && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={handleConfirm}
                        disabled={confirming}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 transition-colors disabled:opacity-50"
                      >
                        <CheckCircle className="h-4 w-4" />
                        {confirming ? 'Confirming…' : 'Confirm'}
                      </button>
                      <button
                        onClick={handleFollowUp}
                        disabled={followingUp}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 text-sm font-medium rounded-md hover:bg-blue-100 transition-colors disabled:opacity-50"
                      >
                        <Clock className="h-4 w-4" />
                        {followingUp ? 'Logging…' : 'Follow Up'}
                      </button>
                      <button
                        onClick={handleReschedule}
                        disabled={rescheduling}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-orange-50 text-orange-700 border border-orange-200 text-sm font-medium rounded-md hover:bg-orange-100 transition-colors disabled:opacity-50"
                      >
                        <RotateCcw className="h-4 w-4" />
                        {rescheduling ? 'Processing…' : 'Re-schedule'}
                      </button>
                    </div>
                  )}

                  {status === 'appointment_confirmed' && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={handleReschedule}
                        disabled={rescheduling}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-orange-50 text-orange-700 border border-orange-200 text-sm font-medium rounded-md hover:bg-orange-100 transition-colors disabled:opacity-50"
                      >
                        <RotateCcw className="h-4 w-4" />
                        {rescheduling ? 'Processing…' : 'Re-schedule'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Field App */}
              <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-[#1a1a1a] mb-4">Field App</h2>
                <dl className="space-y-4">
                  <Field label="Safety Confirmed" value={formatDateTime(inspection.safety_confirmed_at)} />
                  <Field label="Form Submitted" value={formatDateTime(inspection.form_submitted_at)} />
                  <Field label="Person Met" value={inspection.person_met ?? "-"} />
                </dl>
              </div>

              {/* Post-submission */}
              <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-[#1a1a1a] mb-4">Post-submission Status</h2>
                <dl className="space-y-4">
                  <Field label="Scope Status" value={<SubStatusBadge status={inspection.scope_status ?? 'pending'} />} />
                  <Field label="Report Status" value={<SubStatusBadge status={inspection.report_status ?? 'pending'} />} />
                  <Field label="Photos Status" value={<SubStatusBadge status={inspection.photos_status ?? 'pending'} />} />
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
                      inspection.raw_report_notes ? (
                        <span className="whitespace-pre-wrap">{inspection.raw_report_notes}</span>
                      ) : null
                    }
                  />
                </dl>
              </div>
            </div>
          </section>

          {tabs.slice(1).map((tab) => (
            <section key={tab.id} id={tab.id} className="scroll-mt-8">
              <div className="rounded-lg border border-[#1a1a1a]/10 bg-white p-12 shadow-sm">
                <div className="text-center">
                  <FileText className="mx-auto h-12 w-12 text-[#1a1a1a]/20" />
                  <h3 className="mt-4 text-lg font-medium text-[#1a1a1a]">{tab.label}</h3>
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
