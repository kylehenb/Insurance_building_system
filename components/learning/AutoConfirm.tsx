'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AutoConfirmState, Readiness } from '@/lib/learning/auto-confirm'

// Auto-confirm (tech spec §24.7): the banner asking whether to turn it on
// for a kind of card the office hasn't been changing, and the switches on
// Settings → What the AI has learned. Off until someone turns it on.

interface AutoConfirmData {
  state: (AutoConfirmState & { changed_by_name: string | null })[]
  pending: { feature: string; kind: string; readiness: Readiness }[]
  canChange: boolean
}

export const KIND_LABEL: Record<string, string> = { invoice: 'Invoices to pay', attend_submit: 'Attend and Submit', other: 'Everything else' }
const kindName = (k: string) => KIND_LABEL[k] ?? k

function useAutoConfirm() {
  const [data, setData] = useState<AutoConfirmData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/learning/auto-confirm')
    const json = await res.json().catch(() => ({}))
    if (res.ok) setData(json as AutoConfirmData)
    setError(res.ok ? null : json.error ?? 'Could not load auto-confirm')
  }, [])

  useEffect(() => {
    let live = true
    fetch('/api/learning/auto-confirm')
      .then(async res => ({ ok: res.ok, json: await res.json().catch(() => ({})) }))
      .then(({ ok, json }) => {
        if (!live) return
        if (ok) setData(json as AutoConfirmData)
        setError(ok ? null : json.error ?? 'Could not load auto-confirm')
      })
    return () => { live = false }
  }, [])

  async function send(feature: string, kind: string, body: { enabled: boolean } | { dismiss: true }) {
    setBusy(kind)
    const res = await fetch('/api/learning/auto-confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature, kind, ...body }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setError(json.error ?? 'Could not change auto-confirm')
    else await load()
    setBusy(null)
  }

  return { data, error, busy, send }
}

/** "You haven't been changing these — auto-confirm them?" Shown only to people who may change it */
export function AutoConfirmBanner() {
  const { data, error, busy, send } = useAutoConfirm()
  if (!data?.canChange || !data.pending.length) return null
  return (
    <div className="acb">
      {data.pending.map(p => (
        <div key={`${p.feature}:${p.kind}`} className="acb-row">
          <div className="acb-text">
            <strong>You haven&apos;t been changing &ldquo;{kindName(p.kind)}&rdquo; cards.</strong>{' '}
            {p.readiness.accepted} of the last {p.readiness.decided} were confirmed exactly as the AI suggested.
            Turn on auto-confirm so new ones run by themselves?
          </div>
          <div className="acb-actions">
            <button className="acb-on" disabled={busy === p.kind} onClick={() => send(p.feature, p.kind, { enabled: true })}>Turn on</button>
            <button disabled={busy === p.kind} onClick={() => send(p.feature, p.kind, { dismiss: true })}>Not now</button>
            <a href="/dashboard/settings/learning">Details</a>
          </div>
        </div>
      ))}
      {error && <div className="acb-error">{error}</div>}
      <style>{`
        .acb { margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px; }
        .acb-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; background: var(--paper); border: 0.5px solid var(--tan); border-radius: 8px; padding: 10px 14px; }
        .acb-text { flex: 1; min-width: 240px; font-size: 13px; color: var(--ink); line-height: 1.45; }
        .acb-actions { display: flex; align-items: center; gap: 8px; }
        .acb-actions button { font: inherit; font-size: 12px; border: 0.5px solid var(--line-strong); border-radius: 14px; padding: 4px 12px; background: var(--paper); color: var(--ink); cursor: pointer; }
        .acb-actions button.acb-on { background: var(--ink); color: var(--cream); border-color: var(--ink); }
        .acb-actions button:disabled { opacity: 0.5; cursor: default; }
        .acb-actions a { font-size: 12px; color: var(--tan); }
        .acb-error { font-size: 12px; color: #9f1239; }
      `}</style>
    </div>
  )
}

/** The switches, one per kind of card, with how each has been going */
export function AutoConfirmSettings() {
  const { data, error, busy, send } = useAutoConfirm()
  if (!data) return <div className="text-sm text-subtle">{error ?? 'Loading…'}</div>
  return (
    <div>
      <p className="text-xs text-subtle mb-2">
        When it&apos;s on, a new card of that kind runs all of its steps straight away — emails included — as the person who turned it on, with their permissions
        (a step that needs approval still waits for it). Cards you starred yourself and follow-ups are never auto-confirmed. You&apos;ll be asked once a kind
        has been confirmed untouched for 98% of its last 20 cards.
      </p>
      {error && <p className="text-sm text-[#9f1239] mb-2">{error}</p>}
      <div className="bg-white border border-line-3 rounded-lg divide-y divide-line-3">
        {data.state.map(s => (
          <div key={s.kind} className="px-4 py-3 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-ink">{kindName(s.kind)}</div>
              <div className="text-xs text-subtle mt-0.5">
                {s.readiness.decided
                  ? `${s.readiness.accepted} of the last ${s.readiness.decided} confirmed untouched (${s.readiness.pct}%)`
                  : 'No decisions yet'}
                {s.enabled && ` · on, running as ${s.changed_by_name ?? 'whoever turned it on'}`}
                {s.suggested && !s.enabled && ' · ready to turn on'}
              </div>
            </div>
            {data.canChange ? (
              <button
                onClick={() => send(s.feature, s.kind, { enabled: !s.enabled })}
                disabled={busy === s.kind}
                className={`shrink-0 text-xs rounded px-3 py-1 border disabled:opacity-50 ${s.enabled ? 'bg-ink text-cream border-ink' : 'border-line-3 text-ink hover:bg-cream'}`}
              >
                {busy === s.kind ? '…' : s.enabled ? 'On — turn off' : 'Off — turn on'}
              </button>
            ) : (
              <span className="shrink-0 text-xs text-subtle">{s.enabled ? 'On' : 'Off'}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
