'use client'

import { useCallback, useEffect, useState } from 'react'
import type { HealthSummary, Light, MetricValue } from '@/lib/health/daily'
import type { PeriodKind } from '@/lib/health/periods'

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

export function HealthPanel() {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<PeriodKind>('week')
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<HealthSummary | null>(null)
  const [hidden, setHidden] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (k: PeriodKind, o: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/health/summary?period=${k}&offset=${o}`)
      if (res.status === 401 || res.status === 403) { setHidden(true); return }
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Could not load the health check')
      setData(d as HealthSummary)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the health check')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(kind, offset) }, [load, kind, offset])

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
