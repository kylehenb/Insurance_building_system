'use client'

import {
  EXCESS_DECISION_LABELS,
  EXCESS_WAIVER_REASONS,
  type ExcessChoice,
  type ExcessContext,
  type ExcessWaiverReason,
} from '@/lib/excess/decision'
import { formatPerthDateTime } from '@/lib/signing/format'

// The excess checkpoint in "Send for signature". Every insurance job must
// say what happens with the excess before the document can be sent:
//   - an excess invoice already exists → attach it (or not)
//   - an excess is on file → create and attach the invoice, or record why not
//   - no excess on file → warning; confirm there's none, enter the amount, or
//     record why it isn't being collected (e.g. partial cash settlement)

const fmt = (v: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)

export type ExcessMode = 'new_invoice' | 'attach_existing' | 'existing_not_attached' | 'no_excess' | 'not_collecting'

export interface ExcessFormState {
  mode: ExcessMode | null
  amount: string
  reason: ExcessWaiverReason | null
  note: string
}

export function initialExcessForm(ctx: ExcessContext): ExcessFormState {
  const base = { amount: ctx.amount && ctx.amount > 0 ? String(ctx.amount) : '', reason: null, note: '' }
  if (ctx.invoices.length > 0) return { ...base, mode: 'attach_existing' }
  const reason = EXCESS_WAIVER_REASONS.find(r => r.value === ctx.decision)?.value ?? null
  if (reason) return { ...base, mode: 'not_collecting', reason, note: ctx.note ?? '' }
  if (ctx.decision === 'nil') return { ...base, mode: 'no_excess' }
  if (ctx.amount && ctx.amount > 0) return { ...base, mode: 'new_invoice' }
  return { ...base, mode: null }
}

/** The choice to send, or null while the form isn't complete. */
export function excessChoiceFromForm(ctx: ExcessContext, form: ExcessFormState): ExcessChoice | null {
  switch (form.mode) {
    case 'attach_existing':
      return ctx.invoices[0] ? { kind: 'attach_existing', invoiceId: ctx.invoices[0].id } : null
    case 'existing_not_attached':
      return { kind: 'existing_not_attached' }
    case 'new_invoice': {
      const amount = Number(form.amount)
      return Number.isFinite(amount) && amount > 0 ? { kind: 'new_invoice', amountIncGst: Math.round(amount * 100) / 100 } : null
    }
    case 'no_excess':
      return { kind: 'no_excess' }
    case 'not_collecting':
      return form.reason ? { kind: 'not_collecting', reason: form.reason, note: form.note.trim() || null } : null
    default:
      return null
  }
}

/** One line for the review summary, e.g. "excess invoice $500.00". */
export function excessSummary(ctx: ExcessContext, choice: ExcessChoice | null): string | null {
  if (!ctx.applies || !choice) return null
  switch (choice.kind) {
    case 'new_invoice':
      return `new excess invoice ${fmt(choice.amountIncGst)}`
    case 'attach_existing': {
      const inv = ctx.invoices.find(i => i.id === choice.invoiceId)
      return inv ? `excess invoice ${inv.ref ?? ''} ${fmt(inv.amountIncGst)}`.replace(/\s+/g, ' ') : 'excess invoice'
    }
    default:
      return null
  }
}

export function ExcessStep({
  ctx,
  form,
  onChange,
}: {
  ctx: ExcessContext
  form: ExcessFormState
  onChange: (next: ExcessFormState) => void
}) {
  if (!ctx.applies) return null
  const set = (patch: Partial<ExcessFormState>) => onChange({ ...form, ...patch })
  const hasAmount = !!ctx.amount && ctx.amount > 0
  const latest = ctx.invoices[0]
  const label = 'block text-[11px] uppercase tracking-wider text-[#9e998f] font-semibold mb-1.5'
  const option = (active: boolean) =>
    `flex gap-2 rounded-md border px-3 py-2 text-[13px] ${active ? 'border-[#c9a96e] bg-[#fdfaf4]' : 'border-[#e8e4e0]'}`

  const waiver = (
    <label className={option(form.mode === 'not_collecting')}>
      <input type="radio" name="excess-mode" className="mt-0.5" checked={form.mode === 'not_collecting'} onChange={() => set({ mode: 'not_collecting' })} />
      <span className="flex-1">
        <span className="font-medium text-[#1a1a1a]">There’s an excess, but don’t collect it</span>
        {form.mode === 'not_collecting' && (
          <span className="mt-2 block space-y-1">
            {EXCESS_WAIVER_REASONS.map(r => (
              <label key={r.value} className="flex items-center gap-2 text-[12px] text-[#3a3530]">
                <input type="radio" name="excess-reason" checked={form.reason === r.value} onChange={() => set({ reason: r.value })} />
                {r.label}
              </label>
            ))}
            <input
              className="mt-1 w-full rounded-md border border-[#e0dbd4] px-2 py-1.5 text-[12px] focus:border-[#c8b89a] focus:outline-none"
              placeholder="Note (optional), e.g. fence cash settled, excess deducted by insurer"
              value={form.note}
              onChange={e => set({ note: e.target.value })}
            />
          </span>
        )}
      </span>
    </label>
  )

  return (
    <section>
      <div className={label}>Excess</div>

      {ctx.decision && ctx.decidedAt && (
        <p className="mb-2 text-[12px] text-[#9e998f]">
          Previously recorded: {EXCESS_DECISION_LABELS[ctx.decision]}
          {ctx.decidedByName ? ` by ${ctx.decidedByName}` : ''} on {formatPerthDateTime(ctx.decidedAt)}
          {ctx.note ? ` — “${ctx.note}”` : ''}
        </p>
      )}

      {latest ? (
        <div className="space-y-1.5">
          <label className={option(form.mode === 'attach_existing')}>
            <input type="radio" name="excess-mode" className="mt-0.5" checked={form.mode === 'attach_existing'} onChange={() => set({ mode: 'attach_existing' })} />
            <span>
              <span className="font-medium text-[#1a1a1a]">Attach excess invoice {latest.ref ?? ''} ({fmt(latest.amountIncGst)})</span>
              <span className="block text-[12px] text-[#9e998f]">
                Already raised{latest.status === 'sent' ? ' and sent' : ' (draft — it will be marked sent)'}. No new invoice is created.
              </span>
            </span>
          </label>
          <label className={option(form.mode === 'existing_not_attached')}>
            <input type="radio" name="excess-mode" className="mt-0.5" checked={form.mode === 'existing_not_attached'} onChange={() => set({ mode: 'existing_not_attached' })} />
            <span className="font-medium text-[#1a1a1a]">Don’t attach it (already sent separately)</span>
          </label>
        </div>
      ) : (
        <div className="space-y-1.5">
          {!hasAmount && (
            <div className="rounded-md border border-[#f5d9a8] bg-[#fef3e2] px-3 py-2 text-[12px] text-[#92400e]">
              <strong>No excess is recorded for this job.</strong> Check the insurer’s approval before sending.
            </div>
          )}
          <label className={option(form.mode === 'new_invoice')}>
            <input type="radio" name="excess-mode" className="mt-0.5" checked={form.mode === 'new_invoice'} onChange={() => set({ mode: 'new_invoice' })} />
            <span className="flex-1">
              <span className="font-medium text-[#1a1a1a]">Collect the excess — create and attach an excess invoice</span>
              <span className="mt-1 flex items-center gap-2 text-[12px] text-[#5a5650]">
                Amount (inc GST) $
                <input
                  inputMode="decimal"
                  className="w-28 rounded-md border border-[#e0dbd4] px-2 py-1 text-[13px] focus:border-[#c8b89a] focus:outline-none"
                  value={form.amount}
                  onFocus={() => set({ mode: 'new_invoice' })}
                  onChange={e => set({ mode: 'new_invoice', amount: e.target.value.replace(/[^\d.]/g, '') })}
                  aria-label="Excess amount"
                />
                {hasAmount && Number(form.amount) !== ctx.amount && form.amount !== '' && (
                  <span className="text-[#b45309]">The job’s excess ({fmt(ctx.amount!)}) will be updated</span>
                )}
                {!hasAmount && form.amount !== '' && <span className="text-[#9e998f]">Saved to the job</span>}
              </span>
            </span>
          </label>
          {!hasAmount && (
            <label className={option(form.mode === 'no_excess')}>
              <input type="radio" name="excess-mode" className="mt-0.5" checked={form.mode === 'no_excess'} onChange={() => set({ mode: 'no_excess' })} />
              <span>
                <span className="font-medium text-[#1a1a1a]">Confirm there’s no excess on this claim</span>
                <span className="block text-[12px] text-[#9e998f]">Recorded on the job so you’re not asked again.</span>
              </span>
            </label>
          )}
          {waiver}
        </div>
      )}
    </section>
  )
}
