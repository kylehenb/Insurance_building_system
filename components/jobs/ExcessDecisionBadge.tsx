'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  EXCESS_DECISION_LABELS,
  EXCESS_WAIVER_REASONS,
  excessInvoiceStatusLine,
  excessNeedsConfirming,
  type ExcessContext,
  type ExcessDecision,
} from '@/lib/excess/decision'
import { formatPerthDateTime } from '@/lib/signing/format'
import { isPendingApproval, responseError } from '@/lib/approvals/client'
import { ApprovalNotice } from '@/components/approvals/approval-notice'

// The job's excess at a glance (Overview → Excess, Invoices tab), with a way
// to record "no excess" or why it isn't being collected without sending
// anything. Collecting is recorded by raising/sending the excess invoice.

const CHANGED_EVENT = 'irc:job-excess-changed'

/** Tell every excess badge / open loop on the page to reload. */
export function notifyExcessChanged(jobId: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: { jobId } }))
}

export function useJobExcess(jobId: string) {
  const [ctx, setCtx] = useState<ExcessContext | null>(null)

  const reload = useCallback(async () => {
    const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/excess`, { cache: 'no-store' })
    if (res.ok) setCtx(await res.json() as ExcessContext)
  }, [jobId])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/jobs/${encodeURIComponent(jobId)}/excess`, { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then((data: ExcessContext | null) => { if (!cancelled && data) setCtx(data) })
      .catch(() => undefined)
    const onChange = (e: Event) => {
      if ((e as CustomEvent<{ jobId: string }>).detail?.jobId === jobId) void reload()
    }
    window.addEventListener(CHANGED_EVENT, onChange)
    return () => {
      cancelled = true
      window.removeEventListener(CHANGED_EVENT, onChange)
    }
  }, [jobId, reload])

  const record = useCallback(async (decision: ExcessDecision, note: string | null) => {
    const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/excess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, note }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw responseError(body, 'Could not save')
    setCtx(body as ExcessContext)
    notifyExcessChanged(jobId)
  }, [jobId])

  return { ctx, record }
}

type Tone = 'ok' | 'warn' | 'muted'

function statusOf(ctx: ExcessContext): { text: string; tone: Tone } {
  const inv = ctx.invoices[0]
  if (inv) return { text: excessInvoiceStatusLine(inv), tone: inv.paidDate ? 'ok' : 'muted' }
  if (ctx.decision) return { text: EXCESS_DECISION_LABELS[ctx.decision], tone: 'ok' }
  if (excessNeedsConfirming(ctx)) return { text: 'Excess not confirmed', tone: 'warn' }
  return { text: 'Excess not invoiced yet', tone: 'muted' }
}

const TONE_CLASS: Record<Tone, string> = {
  ok: 'border-[#b9dfbb] bg-[#f1f8f1] text-success-dark',
  warn: 'border-[#f5d9a8] bg-warning-bg text-warning-dark',
  muted: 'border-line-3 bg-surface-3 text-body-soft',
}

const SETTABLE: { value: ExcessDecision; label: string }[] = [
  { value: 'nil', label: 'No excess on this claim' },
  ...EXCESS_WAIVER_REASONS.map(r => ({ value: r.value as ExcessDecision, label: `Not collecting: ${r.label}` })),
]

export function ExcessDecisionBadge({ jobId }: { jobId: string }) {
  const { ctx, record } = useJobExcess(jobId)
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState<ExcessDecision | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  if (!ctx || !ctx.applies) return null
  const status = statusOf(ctx)
  // Recording is for jobs without an excess invoice; once invoiced it's being collected.
  const canRecord = ctx.invoices.length === 0

  const startEdit = () => {
    setChoice(ctx.decision && ctx.decision !== 'collect' ? ctx.decision : null)
    setNote(ctx.note ?? '')
    setError(null)
    setOpen(true)
  }

  const save = async () => {
    if (!choice) return
    setSaving(true)
    setError(null)
    setPending(null)
    try {
      await record(choice, note.trim() || null)
      setOpen(false)
    } catch (err) {
      if (isPendingApproval(err)) setPending(err.message)
      else setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-block rounded border px-2 py-0.5 ${TONE_CLASS[status.tone]}`}
          title={ctx.decidedAt ? `Recorded${ctx.decidedByName ? ` by ${ctx.decidedByName}` : ''} ${formatPerthDateTime(ctx.decidedAt)}${ctx.note ? ` — ${ctx.note}` : ''}` : undefined}
        >
          {status.text}
        </span>
        {canRecord && !open && (
          <button type="button" onClick={startEdit} className="text-[#a07840] underline-offset-2 hover:underline">
            {ctx.decision ? 'Change' : 'Record decision'}
          </button>
        )}
      </div>
      {ctx.note && !open && <div className="mt-1 text-subtle">“{ctx.note}”</div>}
      {open && (
        <div className="mt-2 space-y-1 rounded-md border border-line-3 bg-white p-2.5">
          {SETTABLE.map(o => (
            <label key={o.value} className="flex items-center gap-2 text-body">
              <input type="radio" name={`excess-decision-${jobId}`} checked={choice === o.value} onChange={() => setChoice(o.value)} />
              {o.label}
            </label>
          ))}
          <input
            className="mt-1 w-full rounded-md border border-line px-2 py-1.5 focus:border-tan focus:outline-none"
            placeholder="Note (optional)"
            value={note}
            maxLength={1000}
            onChange={e => setNote(e.target.value)}
          />
          {pending && <ApprovalNotice message={pending} />}
          {error && <div className="text-red-700">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={!choice || saving}
              className="rounded bg-ink px-2.5 py-1 font-semibold text-gold disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded border border-[#e0d8c8] px-2.5 py-1 text-body">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
