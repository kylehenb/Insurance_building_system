'use client'

import { useCallback, useEffect, useState } from 'react'
import type { HealthSummary, Light, MetricValue } from '@/lib/health/daily'
import type { PeriodKind } from '@/lib/health/periods'
import type { HealthReview, Fact } from '@/lib/health/review'
import type { SuggestionRow, Decision } from '@/lib/health/suggestions'
import type { AiCosts, CostLine } from '@/lib/health/ai-costs'

type PanelData = HealthSummary & { review: HealthReview | null; suggestions: SuggestionRow[]; inProgress: SuggestionRow[] }
type Decide = (s: SuggestionRow, d: Decision) => void

// System & business health (tech spec §25.3): one line on the Today view
// with a light per area, opening to the figures for a week, month, quarter or
// year (current or up to 4 back), against the period before and the usual.
// Shown only to people with health.view; the API checks it too.

const KINDS: { key: PeriodKind; label: string }[] = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
]

const LIGHT: Record<Light, { colour: string; label: string }> = {
  green: { colour: 'var(--success)', label: 'OK' },
  amber: { colour: 'var(--warning-bright)', label: 'Needs a look' },
  red: { colour: 'var(--danger)', label: 'Problem' },
  grey: { colour: 'var(--faint-4)', label: 'No light' },
}

const GROUPS: MetricValue['group'][] = ['Work in', 'Work done', 'Money', 'On time', 'AI', 'Systems', 'Limits']

function fmt(v: number | null, unit: MetricValue['unit']): string {
  if (v == null) return '—'
  if (unit === 'aud') return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  if (unit === 'usd') return `US$${v.toFixed(2)}`
  if (unit === 'bytes') {
    const gb = v / 1024 ** 3
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(v / 1024 ** 2).toFixed(0)} MB`
  }
  return v.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function Change({ now, then, unit }: { now: number | null; then: number | null; unit: MetricValue['unit'] }) {
  if (now == null || then == null) return <span style={{ color: 'var(--faint)' }}>—</span>
  if (then === 0) return <span style={{ color: 'var(--subtle)' }}>{now === 0 ? 'same' : `from ${fmt(0, unit)}`}</span>
  const pct = Math.round(((now - then) / then) * 100)
  if (pct === 0) return <span style={{ color: 'var(--subtle)' }}>same</span>
  return <span style={{ color: 'var(--body-soft)' }} title={`${fmt(then, unit)}`}>{pct > 0 ? '▲' : '▼'} {Math.abs(pct)}%</span>
}

function Dot({ light, size = 8 }: { light: Light; size?: number }) {
  return <span aria-label={LIGHT[light].label} style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: LIGHT[light].colour, flexShrink: 0 }} />
}

const KIND_LABEL: Record<string, string> = { automation: 'Automation', process: 'Process', wording: 'Wording', system: 'System' }

function Cites({ ids, facts }: { ids: string[]; facts: Map<string, Fact> }) {
  return (
    <>
      {ids.map(id => (
        <span key={id} className="hp-cite" title={facts.get(id)?.text ?? ''}>{id}</span>
      ))}
    </>
  )
}

const STATUS_LABEL: Record<SuggestionRow['status'], string> = { open: 'Open', accepted: 'Accepted', dismissed: 'Dismissed', done: 'Done' }

function SuggestionItem({ s, onDecide, busy }: { s: SuggestionRow; onDecide: Decide; busy: boolean }) {
  const facts = new Map(s.evidence.map(f => [f.id, f]))
  return (
    <div className="hp-sugg">
      <div className="hp-sugg-title">
        {s.title} <span className="hp-tag">{KIND_LABEL[s.kind] ?? s.kind}</span><span className="hp-tag">{s.effort} effort</span>
        {s.times_raised > 1 && <span className="hp-tag">raised {s.times_raised} times</span>}
        {s.status !== 'open' && <span className={`hp-tag hp-status-${s.status}`}>{STATUS_LABEL[s.status]}</span>}
      </div>
      <div className="hp-sugg-why">{s.why} <Cites ids={s.evidence.map(f => f.id)} facts={facts} /></div>
      {s.note && <div className="hp-sugg-note">Note: {s.note}</div>}
      <div className="hp-sugg-actions">
        {s.status === 'open' && <>
          <button className="hp-btn hp-btn-dark" disabled={busy} onClick={() => onDecide(s, 'accepted')}>Accept</button>
          <button className="hp-btn" disabled={busy} onClick={() => onDecide(s, 'dismissed')}>Dismiss</button>
        </>}
        {s.status === 'accepted' && <button className="hp-btn hp-btn-dark" disabled={busy} onClick={() => onDecide(s, 'done')}>Mark done</button>}
        {s.status !== 'open' && <button className="hp-btn" disabled={busy} onClick={() => onDecide(s, 'open')}>Reopen</button>}
      </div>
    </div>
  )
}

function ReviewCard({ review, offset, kind, suggestions, onDecide, busy }: { review: HealthReview | null; offset: number; kind: PeriodKind; suggestions: SuggestionRow[]; onDecide: Decide; busy: string | null }) {
  const [showFacts, setShowFacts] = useState(false)
  if (offset === 0) return <div className="hp-review hp-review-empty">The written review of this {kind} comes the night after it ends.</div>
  if (!review) return <div className="hp-review hp-review-empty">No written review yet. Reviews are written overnight once the {kind}&apos;s figures are in (the last 4 {kind}s are filled in over the first few nights).</div>
  if (review.status === 'failed') return <div className="hp-review hp-review-empty">The review couldn&apos;t be written ({review.error}). It&apos;s tried again overnight{review.attempts >= 3 ? ' — no more tries left' : ''}.</div>
  const facts = new Map(review.facts.map(f => [f.id, f]))
  return (
    <div className="hp-review">
      <div className="hp-review-head">{review.headline}</div>
      <div className="hp-review-cols">
        {review.sections.filter(sec => sec.points.length).map(sec => (
          <div key={sec.key}>
            <div className="hp-group-name">{sec.title}</div>
            <ul className="hp-points">
              {sec.points.map((pt, i) => <li key={i}>{pt.text} <Cites ids={pt.facts} facts={facts} /></li>)}
            </ul>
          </div>
        ))}
      </div>
      {suggestions.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <div className="hp-group-name">Suggested changes</div>
          {suggestions.map(sg => <SuggestionItem key={sg.id} s={sg} onDecide={onDecide} busy={busy === sg.id} />)}
        </div>
      ) : review.suggestions.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="hp-group-name">Suggested changes</div>
          {review.suggestions.map((sg, i) => (
            <div key={i} className="hp-sugg">
              <div className="hp-sugg-title">{sg.title} <span className="hp-tag">{KIND_LABEL[sg.kind] ?? sg.kind}</span><span className="hp-tag">{sg.effort} effort</span></div>
              <div className="hp-sugg-why">{sg.why} <Cites ids={sg.facts} facts={facts} /></div>
            </div>
          ))}
        </div>
      )}
      <button className="hp-link" onClick={() => setShowFacts(v => !v)}>{showFacts ? 'Hide' : 'Show'} the {review.facts.length} facts it was written from</button>
      {showFacts && <ol className="hp-facts">{review.facts.map(f => <li key={f.id}><b>{f.id}</b> {f.text}</li>)}</ol>}
      <div className="hp-note" style={{ marginTop: 6 }}>Written by AI from these facts only; hover a fact number to see it.</div>
    </div>
  )
}

const money = (n: number) => (n > 0 && n < 0.01 ? '<1¢' : `US$${n.toFixed(2)}`)

function CostTable({ lines, first, showWhat }: { lines: CostLine[]; first: string; showWhat?: boolean }) {
  return (
    <table className="hp-table hp-cost">
      <thead><tr><th>{first}</th><th>Requests</th><th>Spend</th><th>Share</th><th>Each</th><th>vs before</th></tr></thead>
      <tbody>
        {lines.map(l => (
          <tr key={l.key}>
            <td>
              <div style={{ color: 'var(--ink)' }}>{l.label}</div>
              {showWhat && l.what && <div className="hp-cost-what">{l.what}</div>}
              {(l.failed > 0 || l.unpriced > 0) && <div className="hp-cost-what">{l.failed ? `${l.failed} failed` : ''}{l.failed && l.unpriced ? ' · ' : ''}{l.unpriced ? `${l.unpriced} with no price set` : ''}</div>}
            </td>
            <td>{l.calls.toLocaleString()}</td>
            <td className="hp-val">{money(l.costUsd)}</td>
            <td><span className="hp-share"><span style={{ width: `${Math.round(l.share * 100)}%` }} /></span>{Math.round(l.share * 100)}%</td>
            <td>{l.costPerCall == null ? '—' : money(l.costPerCall)}</td>
            <td><Change now={l.costUsd} then={l.previousCostUsd} unit="usd" /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Where the AI money goes: collapsed until asked for, then loaded for the period on show. */
function AiCostSection({ kind, offset }: { kind: PeriodKind; offset: number }) {
  const [open, setOpen] = useState(false)
  const [costs, setCosts] = useState<AiCosts | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [byModel, setByModel] = useState(false)

  const loadCosts = useCallback(async (k: PeriodKind, o: number) => {
    setError(null)
    try {
      const r = await fetch(`/api/health/ai-costs?period=${k}&offset=${o}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Could not load AI costs')
      setCosts(d as AiCosts)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load AI costs')
    }
  }, [])

  useEffect(() => { if (open) void loadCosts(kind, offset) }, [open, kind, offset, loadCosts])

  return (
    <div className="hp-costs">
      <button className="hp-costs-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span>Where the AI money goes</span>
        <span className="hp-chev" style={{ transform: open ? 'rotate(180deg)' : undefined }}>▾</span>
      </button>
      {open && (
        <div className="hp-costs-body">
          {error && <div className="hp-err">{error}</div>}
          {!costs && !error && <div className="hp-note">Loading…</div>}
          {costs && (costs.calls === 0 ? (
            <div className="hp-note">{costs.trackedSince ? `No AI requests in ${costs.period.label.toLowerCase()}.` : 'AI costs have only just started being recorded.'}</div>
          ) : (
            <>
              <div className="hp-costs-total">
                <b>{money(costs.totalUsd)}</b> on {costs.calls.toLocaleString()} requests over {costs.daysCounted} day{costs.daysCounted === 1 ? '' : 's'} · about <b>{money(costs.perDayUsd)}</b> a day
                {costs.previousTotalUsd > 0 && <> · <Change now={costs.totalUsd} then={costs.previousTotalUsd} unit="usd" /> on the same days before</>}
              </div>
              <div className="hp-tabs" style={{ marginBottom: 10 }}>
                <button className={`hp-tab${!byModel ? ' on' : ''}`} onClick={() => setByModel(false)}>By feature</button>
                <button className={`hp-tab${byModel ? ' on' : ''}`} onClick={() => setByModel(true)}>By model</button>
              </div>
              {byModel ? <CostTable lines={costs.models} first="Model" /> : <CostTable lines={costs.features} first="Feature" showWhat />}
              <div className="hp-note" style={{ marginTop: 8 }}>
                Recorded from {costs.trackedSince ?? '3 Nov 2026'}. Includes Midcity&apos;s features (marked), which are a separate business. Spend per person isn&apos;t recorded yet.
              </div>
            </>
          ))}
        </div>
      )}
    </div>
  )
}

export function HealthPanel() {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<PeriodKind>('week')
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<PanelData | null>(null)
  const [hidden, setHidden] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async (k: PeriodKind, o: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/health/summary?period=${k}&offset=${o}`)
      if (res.status === 401 || res.status === 403) { setHidden(true); return }
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Could not load the health check')
      setData(d as PanelData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the health check')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(kind, offset) }, [load, kind, offset])

  const decide: Decide = async (sg, decision) => {
    let note: string | null = null
    if (decision === 'dismissed') {
      note = window.prompt('Why dismiss it? (optional — the next reviews learn from this)')
      if (note === null) return
    } else if (decision === 'done') {
      note = window.prompt('How was it done? (optional)')
      if (note === null) return
    }
    setBusy(sg.id)
    setError(null)
    try {
      const res = await fetch(`/api/health/suggestions/${sg.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, note }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) setError(d.error ?? 'Could not save the decision')
      await load(kind, offset)
    } finally {
      setBusy(null)
    }
  }

  if (hidden) return null

  const worst = data?.areas.reduce<Light>((w, a) => (a.light === 'red' || (a.light === 'amber' && w !== 'red') ? a.light : w), 'green')

  return (
    <div className="hp">
      <style>{`
        .hp { background: var(--paper); border: 0.5px solid var(--line-2); border-radius: 10px; margin-bottom: 28px; overflow: hidden; }
        .hp-head { width: 100%; display: flex; align-items: center; gap: 14px; padding: 12px 18px; background: var(--surface-6); border: 0; cursor: pointer; text-align: left; flex-wrap: wrap; }
        .hp-head:hover { background: var(--surface-3); }
        .hp-title { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: var(--tan); font-weight: 700; margin-right: auto; display: flex; align-items: center; gap: 8px; }
        .hp-lights { display: flex; gap: 14px; flex-wrap: wrap; }
        .hp-light { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--body-soft); }
        .hp-chev { color: var(--subtle); font-size: 12px; transition: transform .15s; }
        .hp-body { border-top: 0.5px solid var(--line-faint); padding: 16px 18px 20px; }
        .hp-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
        .hp-tabs { display: inline-flex; border: 0.5px solid var(--line-strong); border-radius: 8px; overflow: hidden; }
        .hp-tab { font-size: 12px; padding: 6px 12px; background: var(--paper); border: 0; color: var(--body-soft); cursor: pointer; }
        .hp-tab + .hp-tab { border-left: 0.5px solid var(--line-strong); }
        .hp-tab.on { background: var(--ink); color: var(--cream); }
        .hp-select { font-size: 12px; padding: 6px 8px; border: 0.5px solid var(--line-strong); border-radius: 8px; background: var(--paper); color: var(--body); }
        .hp-note { font-size: 11px; color: var(--faint); }
        .hp-areas { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 18px; }
        .hp-area { border: 0.5px solid var(--line-faint); border-radius: 8px; padding: 10px 12px; }
        .hp-area-name { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; color: var(--ink); margin-bottom: 4px; }
        .hp-area-note { font-size: 12px; color: var(--body-soft); line-height: 1.4; }
        .hp-alerts { margin-bottom: 18px; }
        .hp-alert { display: flex; gap: 10px; align-items: flex-start; padding: 8px 0; border-top: 0.5px solid var(--line-faint); font-size: 12px; color: var(--body); }
        .hp-alert:first-of-type { border-top: 0; }
        .hp-alert-detail { color: var(--subtle); margin-top: 2px; }
        .hp-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 18px 28px; }
        .hp-group-name { font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--subtle); font-weight: 700; margin-bottom: 6px; }
        .hp-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .hp-table th { font-weight: 500; color: var(--faint); text-align: right; padding: 3px 0 5px 10px; font-size: 11px; }
        .hp-table th:first-child { text-align: left; padding-left: 0; }
        .hp-table td { padding: 5px 0 5px 10px; border-top: 0.5px solid var(--line-faint); text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .hp-table td:first-child { text-align: left; padding-left: 0; color: var(--body); white-space: normal; }
        .hp-val { color: var(--ink); font-weight: 600; }
        .hp-err { font-size: 12px; color: var(--danger); }
        .hp-review { border: 0.5px solid var(--line-tan-5); background: var(--surface-9); border-radius: 8px; padding: 14px 16px; margin-bottom: 18px; }
        .hp-review-empty { font-size: 12px; color: var(--subtle); }
        .hp-review-head { font-size: 14px; font-weight: 600; color: var(--ink); margin-bottom: 12px; line-height: 1.45; }
        .hp-review-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px 24px; }
        .hp-points { margin: 0; padding-left: 16px; font-size: 12.5px; color: var(--body); line-height: 1.5; }
        .hp-points li { margin-bottom: 5px; }
        .hp-cite { display: inline-block; font-size: 9.5px; color: var(--bronze); background: var(--cream); border: 0.5px solid var(--line-tan-5); border-radius: 4px; padding: 0 4px; margin-left: 3px; cursor: help; vertical-align: 1px; }
        .hp-sugg { padding: 8px 0; border-top: 0.5px solid var(--line-faint); }
        .hp-sugg:first-of-type { border-top: 0; }
        .hp-sugg-title { font-size: 12.5px; font-weight: 600; color: var(--ink); }
        .hp-sugg-why { font-size: 12px; color: var(--body-soft); margin-top: 3px; line-height: 1.45; }
        .hp-tag { font-size: 10px; font-weight: 500; color: var(--subtle); border: 0.5px solid var(--line-strong); border-radius: 10px; padding: 0 7px; margin-left: 6px; }
        .hp-link { background: none; border: 0; padding: 0; margin-top: 12px; font-size: 11.5px; color: var(--bronze); cursor: pointer; text-decoration: underline; }
        .hp-facts { font-size: 11.5px; color: var(--body-soft); padding-left: 18px; margin: 8px 0 0; line-height: 1.5; max-height: 280px; overflow-y: auto; list-style: none; }
        .hp-facts li { margin-bottom: 3px; }
        .hp-costs { border: 0.5px solid var(--line-faint); border-radius: 8px; margin-bottom: 18px; }
        .hp-costs-head { width: 100%; display: flex; justify-content: space-between; align-items: center; background: none; border: 0; padding: 10px 12px; cursor: pointer; font-size: 12px; font-weight: 600; color: var(--ink); }
        .hp-costs-body { padding: 0 12px 12px; }
        .hp-costs-total { font-size: 12.5px; color: var(--body); margin-bottom: 10px; }
        .hp-cost td:first-child { min-width: 200px; }
        .hp-cost-what { font-size: 11px; color: var(--subtle); margin-top: 2px; line-height: 1.35; }
        .hp-share { display: inline-block; width: 44px; height: 5px; background: var(--line-faint); border-radius: 3px; margin-right: 6px; vertical-align: middle; overflow: hidden; }
        .hp-share span { display: block; height: 100%; background: var(--tan); }
        .hp-sugg-note { font-size: 11.5px; color: var(--subtle); margin-top: 3px; font-style: italic; }
        .hp-sugg-actions { display: flex; gap: 6px; margin-top: 6px; }
        .hp-btn { font-size: 11.5px; padding: 4px 10px; border-radius: 6px; border: 0.5px solid var(--line-strong); background: var(--paper); color: var(--body); cursor: pointer; }
        .hp-btn:disabled { opacity: .5; cursor: default; }
        .hp-btn-dark { background: var(--ink); color: var(--cream); border-color: var(--ink); }
        .hp-status-accepted { color: var(--info-dark); border-color: var(--info-soft); }
        .hp-status-done { color: var(--success); border-color: var(--success); }
        .hp-status-dismissed { color: var(--faint); }
      `}</style>

      <button className="hp-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="hp-title">{worst && <Dot light={worst} />}System &amp; business health</span>
        <span className="hp-lights">
          {data?.areas.map(a => (
            <span key={a.key} className="hp-light" title={a.note}><Dot light={a.light} />{a.label}</span>
          ))}
          {!data && loading && <span className="hp-light">Checking…</span>}
        </span>
        <span className="hp-chev" style={{ transform: open ? 'rotate(180deg)' : undefined }}>▾</span>
      </button>

      {open && (
        <div className="hp-body">
          <div className="hp-bar">
            <div className="hp-tabs" role="tablist">
              {KINDS.map(k => (
                <button key={k.key} role="tab" aria-selected={kind === k.key} className={`hp-tab${kind === k.key ? ' on' : ''}`}
                  onClick={() => { setKind(k.key); setOffset(0) }}>{k.label}</button>
              ))}
            </div>
            <select className="hp-select" value={offset} onChange={e => setOffset(Number(e.target.value))} aria-label="Which period">
              {(data?.periods ?? [{ offset: 0, label: '…' }]).map(p => <option key={p.offset} value={p.offset}>{p.label}</option>)}
            </select>
            {data && (
              <span className="hp-note">
                {data.period.offset === 0 ? `${data.daysCounted} day${data.daysCounted === 1 ? '' : 's'} so far, compared with the same days of earlier ${kind}s` : `Compared with the ${kind} before and the usual (average of the 4 before)`}
              </span>
            )}
            {loading && <span className="hp-note">Loading…</span>}
          </div>

          {error && <div className="hp-err">{error}</div>}

          {data && (
            <>
              <ReviewCard review={data.review} offset={data.period.offset} kind={kind} suggestions={data.suggestions ?? []} onDecide={decide} busy={busy} />

              {(data.inProgress ?? []).filter(sg => !(data.suggestions ?? []).some(x => x.id === sg.id)).length > 0 && (
                <div className="hp-review" style={{ background: 'var(--paper)' }}>
                  <div className="hp-group-name">Changes you&apos;ve accepted, not yet done</div>
                  {(data.inProgress ?? []).filter(sg => !(data.suggestions ?? []).some(x => x.id === sg.id)).map(sg => <SuggestionItem key={sg.id} s={sg} onDecide={decide} busy={busy === sg.id} />)}
                </div>
              )}

              <div className="hp-areas">
                {data.areas.map(a => (
                  <div key={a.key} className="hp-area">
                    <div className="hp-area-name"><Dot light={a.light} />{a.label}</div>
                    <div className="hp-area-note">{a.note}</div>
                  </div>
                ))}
              </div>

              {data.alerts.length > 0 && (
                <div className="hp-alerts">
                  <div className="hp-group-name">Open alerts</div>
                  {data.alerts.map(a => (
                    <div key={a.key} className="hp-alert">
                      <Dot light={a.severity === 'critical' ? 'red' : 'amber'} />
                      <div>
                        <div>{a.title}</div>
                        {a.detail && <div className="hp-alert-detail">{a.detail}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <AiCostSection kind={kind} offset={offset} />

              <div className="hp-groups">
                {GROUPS.map(g => {
                  const rows = data.metrics.filter(m => m.group === g)
                  if (!rows.length) return null
                  return (
                    <div key={g}>
                      <div className="hp-group-name">{g}</div>
                      <table className="hp-table">
                        <thead><tr><th>{data.period.label}</th><th></th><th>vs before</th><th>vs usual</th></tr></thead>
                        <tbody>
                          {rows.map(m => (
                            <tr key={m.key}>
                              <td>{m.label}</td>
                              <td className="hp-val" title={m.value == null ? 'Not tracked in this period' : m.partial ? 'Only tracked for part of this period' : undefined}>
                                {fmt(m.value, m.unit)}{m.partial ? '*' : ''}
                              </td>
                              <td><Change now={m.value} then={m.previous} unit={m.unit} /></td>
                              <td>{m.typical == null ? <span style={{ color: 'var(--faint)' }}>—</span> : <Change now={m.value} then={m.typical} unit={m.unit} />}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                })}
              </div>
              <div className="hp-note" style={{ marginTop: 14 }}>
                — not tracked in this period · * tracked for part of it. AI spend, scheduled jobs and errors are recorded from 3 Nov 2026; open jobs, money owed and sizes from the first nightly reading.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
