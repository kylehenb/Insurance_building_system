'use client';

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CLOSED_LABELS, phaseLabel, STEP_LABELS, type ClosedReason } from "@/lib/jobs/phase";

// The clean-up of old jobs (tech spec §23.15): open jobs with nothing on them
// for 90 days, each with the reason it most likely closed. Nothing closes
// until the office ticks the jobs, checks the reasons and presses Close.

type Candidate = {
  id: string
  job_number: string
  property_address: string | null
  insurer: string | null
  phase: string | null
  phase_step: string | null
  last_activity: string | null
  suggested: ClosedReason
  why: string
}

const REASONS: ClosedReason[] = ["complete", "declined", "cancelled", "no_decision"];

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function phaseText(c: Candidate): string {
  const phase = c.phase ? phaseLabel(c.phase) : "—";
  const step = c.phase_step ? (STEP_LABELS as Record<string, string>)[c.phase_step] : null;
  return step ? `${phase} · ${step}` : phase;
}

export default function CleanupJobsPage() {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [reasons, setReasons] = useState<Record<string, ClosedReason>>({});
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/jobs/cleanup");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Could not load the old jobs");
      setCandidates([]);
      return;
    }
    const list = (body.candidates ?? []) as Candidate[];
    setCandidates(list);
    setReasons(Object.fromEntries(list.map(c => [c.id, c.suggested])));
    setTicked(new Set());
  }

  useEffect(() => {
    fetch("/api/jobs/cleanup")
      .then(async res => ({ ok: res.ok, body: await res.json().catch(() => ({})) }))
      .then(({ ok, body }) => {
        const list = ok ? ((body.candidates ?? []) as Candidate[]) : [];
        if (!ok) setError(body.error ?? "Could not load the old jobs");
        setCandidates(list);
        setReasons(Object.fromEntries(list.map(c => [c.id, c.suggested])));
      });
  }, []);

  const allTicked = useMemo(() => !!candidates?.length && ticked.size === candidates.length, [candidates, ticked]);

  function toggle(id: string) {
    setTicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function closeTicked() {
    if (!ticked.size) return;
    if (!confirm(`Close ${ticked.size} job${ticked.size === 1 ? "" : "s"}? A job can be reopened from its page.`)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const items = [...ticked].map(jobId => ({ jobId, reason: reasons[jobId] }));
    const res = await fetch("/api/jobs/close", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (body.pendingApproval) {
      setMessage("Sent for approval — the jobs close once it's approved.");
      setTicked(new Set());
      return;
    }
    if (!res.ok) {
      setError(body.error ?? "Could not close the jobs");
      return;
    }
    setMessage(`Closed ${(body.closed as string[]).length} job${(body.closed as string[]).length === 1 ? "" : "s"}.`);
    await load();
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <Link href="/dashboard/jobs" className="text-xs text-ink/60 hover:text-ink">← Jobs</Link>
        <div className="mt-2 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Close Old Jobs</h1>
            <p className="mt-1 text-sm text-ink/60">
              Open jobs with nothing on them for 90 days. Tick the ones that are finished, check the reason, then close them.
            </p>
          </div>
          <button
            onClick={closeTicked}
            disabled={!ticked.size || busy}
            className="inline-flex items-center justify-center rounded-lg bg-ink px-4 py-2 text-sm font-medium text-cream hover:bg-ink/90 transition-colors disabled:opacity-40"
          >
            {busy ? "Closing…" : `Close ${ticked.size || ""} Selected`.replace("  ", " ")}
          </button>
        </div>

        {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
        {message && <div className="mt-4 rounded-lg border border-line-2 bg-cream px-4 py-2 text-sm text-ink">{message}</div>}

        <div className="mt-4 rounded-lg border border-line-2 bg-white shadow-sm overflow-hidden">
          {candidates === null ? (
            <div className="py-16 text-center text-sm text-faint">Loading...</div>
          ) : candidates.length === 0 ? (
            <div className="py-16 text-center text-sm text-ink/60">No old open jobs — nothing to clean up.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-line-faint">
                <thead className="bg-surface-6">
                  <tr>
                    <th className="px-3 py-2.5 text-left">
                      <input
                        type="checkbox"
                        aria-label="Tick all"
                        checked={allTicked}
                        onChange={() => setTicked(allTicked ? new Set() : new Set(candidates.map(c => c.id)))}
                      />
                    </th>
                    {["Job", "Address", "Insurer", "Phase now", "Last activity", "Close as", "Why"].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-faint">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-faint bg-white">
                  {candidates.map(c => (
                    <tr key={c.id} className={ticked.has(c.id) ? "bg-cream/60" : "hover:bg-surface-3"}>
                      <td className="px-3 py-3">
                        <input type="checkbox" aria-label={`Tick ${c.job_number}`} checked={ticked.has(c.id)} onChange={() => toggle(c.id)} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <Link href={`/dashboard/jobs/${c.id}`} className="text-xs font-medium text-tan hover:underline">{c.job_number}</Link>
                      </td>
                      <td className="px-3 py-3 text-xs text-ink/70 max-w-xs truncate">{c.property_address ?? "—"}</td>
                      <td className="px-3 py-3 text-xs text-ink">{c.insurer ?? "—"}</td>
                      <td className="px-3 py-3 text-xs text-ink/70">{phaseText(c)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-ink/70">{shortDate(c.last_activity)}</td>
                      <td className="px-3 py-3">
                        <select
                          value={reasons[c.id]}
                          onChange={e => setReasons(r => ({ ...r, [c.id]: e.target.value as ClosedReason }))}
                          className="rounded border border-line-2 bg-white px-2 py-1 text-xs text-ink"
                        >
                          {REASONS.map(r => <option key={r} value={r}>{CLOSED_LABELS[r]}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-3 text-xs text-ink/60">{c.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
