'use client'

import { useCallback, useEffect, useState } from 'react'
import type { LessonView } from '@/lib/learning/lessons'
import type { FeatureStats, Tally } from '@/lib/learning/stats'
import type { ReviewResult } from '@/lib/learning/review'
import { AutoConfirmSettings } from '@/components/learning/AutoConfirm'

// Settings → What the AI has learned (tech spec §24.6): how often the AI's
// proposals are confirmed untouched, and the lessons it has picked up from
// what the office does — read-only, with an off switch for a wrong one.
// Nothing here needs looking after: the AI learns in the background.

interface LearningData {
  days: number
  lessons: LessonView[]
  stats: FeatureStats[]
  reviews: { feature: string; ran_at: string; summary: ReviewResult | null }[]
  canChange: boolean
}

const FEATURE: Record<string, string> = { action_card: 'Action cards', order_parse: 'Reading insurer orders', report: 'Report writing', photo_labels: 'Photo labels', waiting_on: 'Waiting on (when to chase)' }
const KIND: Record<string, string> = {
  invoice: 'Invoices to pay', attend_submit: 'Attend and Submit', other: 'Everything else',
  bar: 'BAR', make_safe: 'Make safe', roof: 'Roof', specialist: 'Specialist', ldr: 'Leak detection',
}
const DAY_OPTIONS = [7, 30, 90]

const featureName = (f: string) => FEATURE[f] ?? f.replace(/_/g, ' ')
const pct = (t: Tally) => (t.decided ? Math.round((t.accepted / t.decided) * 100) : null)
const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const date = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })

function Accuracy({ s, days }: { s: FeatureStats; days: number }) {
  const now = pct(s.current)
  const before = pct(s.previous)
  const diff = now !== null && before !== null ? now - before : null
  return (
    <div className="bg-white border border-line-3 rounded-lg p-4">
      <div className="flex items-baseline justify-between gap-4">
        <div className="text-sm font-semibold text-ink">{featureName(s.feature)}</div>
        <div className="text-xs text-subtle">last {days} days</div>
      </div>
      {s.current.decided === 0 ? (
        <p className="text-sm text-subtle mt-2">Nothing decided in this period yet.</p>
      ) : (
        <>
          <div className="flex items-baseline gap-3 mt-2">
            <span className="text-3xl font-semibold text-ink">{now}%</span>
            <span className="text-sm text-subtle">confirmed as the AI proposed</span>
            {diff !== null && (
              <span className={`text-xs ${diff >= 0 ? 'text-[#2d6a4f]' : 'text-[#9f1239]'}`}>
                {diff >= 0 ? '▲' : '▼'} {Math.abs(diff)} pts on the {days} days before
              </span>
            )}
          </div>
          <p className="text-xs text-subtle mt-1">
            {s.current.decided} decided: {s.current.accepted} as proposed, {s.current.edited} changed, {s.current.skipped} skipped
            {s.current.instructed ? ` · sent back with instructions ${s.current.instructed} time${s.current.instructed === 1 ? '' : 's'}` : ''}
          </p>
          {s.byKind.length > 1 && (
            <div className="mt-3 space-y-1.5">
              {s.byKind.filter(k => k.decided).map(k => (
                <div key={k.kind ?? 'none'} className="flex items-center gap-3 text-xs">
                  <div className="w-36 shrink-0 text-subtle">{k.kind ? KIND[k.kind] ?? k.kind : 'Not sorted'}</div>
                  <div className="flex-1 h-1.5 bg-line-3 rounded">
                    <div className="h-1.5 bg-tan rounded" style={{ width: `${pct(k) ?? 0}%` }} />
                  </div>
                  <div className="w-24 shrink-0 text-right text-ink">{pct(k)}% of {k.decided}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Lesson({ l, canChange, busy, onToggle }: { l: LessonView; canChange: boolean; busy: boolean; onToggle: (l: LessonView) => void }) {
  const on = l.status === 'active'
  return (
    <div className="px-4 py-3 flex items-start gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-xs text-subtle">When: {l.applies_when}</div>
        <div className={`text-sm mt-0.5 whitespace-pre-wrap ${on ? 'text-ink' : 'text-subtle'}`}>{l.lesson}</div>
        <div className="text-xs text-subtle mt-1">
          {featureName(l.feature)} · {l.source === 'migrated' ? 'from the old Brain' : 'learned'} · borne out {l.support_count}, against {l.contradict_count} · {on ? `since ${date(l.created_at)}` : l.retired_reason ?? 'Retired'}
        </div>
      </div>
      {canChange && (
        <button
          onClick={() => onToggle(l)}
          disabled={busy}
          className="shrink-0 text-xs border border-line-3 rounded px-2 py-1 text-ink hover:bg-cream disabled:opacity-50"
        >
          {busy ? '…' : on ? 'Turn off' : 'Turn back on'}
        </button>
      )}
    </div>
  )
}

export default function LearningPage() {
  const [data, setData] = useState<LearningData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(30)
  const [showOff, setShowOff] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async (d: number) => {
    const res = await fetch(`/api/learning?days=${d}`)
    const json = await res.json().catch(() => ({}))
    if (res.ok) setData(json as LearningData)
    setError(res.ok ? null : json.error ?? 'Could not load what the AI has learned')
  }, [])

  useEffect(() => {
    let live = true
    fetch(`/api/learning?days=${days}`)
      .then(async res => ({ ok: res.ok, json: await res.json().catch(() => ({})) }))
      .then(({ ok, json }) => {
        if (!live) return
        if (ok) setData(json as LearningData)
        setError(ok ? null : json.error ?? 'Could not load what the AI has learned')
      })
    return () => { live = false }
  }, [days])

  async function toggle(l: LessonView) {
    setBusy(l.id)
    const res = await fetch(`/api/learning/lessons/${l.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: l.status !== 'active' }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setError(json.error ?? 'Could not change the lesson')
    else await load(days)
    setBusy(null)
  }

  if (!data) return <div className="p-8 text-sm text-subtle">{error ?? 'Loading…'}</div>

  const active = data.lessons.filter(l => l.status === 'active')
  const off = data.lessons.filter(l => l.status !== 'active')

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <a href="/dashboard/settings" className="text-xs text-subtle hover:text-ink">← Settings</a>
        <h1 className="text-2xl font-semibold text-ink mt-1">What the AI has learned</h1>
        <p className="text-sm text-subtle mt-1">
          The AI learns from what the office does with its suggestions — what you confirm, change, skip or tell it — and gets checked every night.
          Nothing here needs looking after; turn a lesson off if it&apos;s wrong.
        </p>
        {error && <p className="text-sm text-[#9f1239] mt-2">{error}</p>}
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-ink">How often it gets it right</h2>
        <select value={days} onChange={e => setDays(Number(e.target.value))} className="border border-line-3 rounded px-2 py-1 text-sm bg-white">
          {DAY_OPTIONS.map(d => <option key={d} value={d}>Last {d} days</option>)}
        </select>
      </div>
      <div className="grid gap-3 mb-8">
        {data.stats.length === 0 && (
          <div className="bg-white border border-line-3 rounded-lg px-4 py-6 text-sm text-subtle text-center">
            No decisions yet — confirm, change or skip a few action cards and this fills in.
          </div>
        )}
        {data.stats.map(s => <Accuracy key={s.feature} s={s} days={data.days} />)}
      </div>

      <h2 className="text-sm font-semibold text-ink mb-2">Auto-confirm action cards</h2>
      <div className="mb-8"><AutoConfirmSettings /></div>

      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold text-ink">Lessons in use ({active.length})</h2>
        <div className="text-xs text-subtle">
          {data.reviews.length
            ? data.reviews.map(r => `${featureName(r.feature)} last checked ${when(r.ran_at)}${r.summary ? ` (${r.summary.reviewed} new, ${r.summary.added} added, ${r.summary.retired} retired)` : ''}`).join(' · ')
            : 'Checked every night at 2am'}
        </div>
      </div>
      <div className="bg-white border border-line-3 rounded-lg divide-y divide-line-3">
        {active.length === 0 && <div className="px-4 py-6 text-sm text-subtle text-center">No lessons yet. They appear once the same thing has happened more than once.</div>}
        {active.map(l => <Lesson key={l.id} l={l} canChange={data.canChange} busy={busy === l.id} onToggle={toggle} />)}
      </div>

      {off.length > 0 && (
        <div className="mt-6">
          <button onClick={() => setShowOff(v => !v)} className="text-xs text-tan hover:underline">
            {showOff ? 'Hide' : 'Show'} {off.length} lesson{off.length === 1 ? '' : 's'} no longer in use
          </button>
          {showOff && (
            <div className="bg-white border border-line-3 rounded-lg divide-y divide-line-3 mt-2">
              {off.map(l => <Lesson key={l.id} l={l} canChange={data.canChange} busy={busy === l.id} onToggle={toggle} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
