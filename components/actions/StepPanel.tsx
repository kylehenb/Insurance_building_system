'use client'

import { useEffect, useState } from 'react'
import type { CardStep, CardWithContext } from '@/lib/actions/cards'
import type { StepDetail } from '@/lib/actions/steps'
import type { StepField } from '@/lib/actions/step-fields'

// A step on an action card, opened: what it will do in full (the note's
// text, the order to lodge, the work order or documents and their email),
// with its details editable before it runs. Saving changes the step, not the
// job — that happens when the step is done. An order can be corrected
// straight away, as on the Insurer Orders page.

type Values = Record<string, string | number | boolean | null>

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong')
  return data
}

const valuesOf = (fields: StepField[]): Values => Object.fromEntries(fields.map(f => [f.key, f.value]))
const changed = (now: Values, was: Values) => Object.fromEntries(Object.entries(now).filter(([k, v]) => (v ?? '') !== (was[k] ?? '')))

interface Props {
  card: CardWithContext
  step: CardStep
  editable: boolean
  onCard(card: CardWithContext): void
  onMessage(text: string, error?: boolean): void
  onDirty(dirty: boolean): void
}

export function StepPanel({ card, step, editable, onCard, onMessage, onDirty }: Props) {
  const [detail, setDetail] = useState<StepDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [values, setValues] = useState<Values>({})
  const [record, setRecord] = useState<Values>({})
  const [busy, setBusy] = useState<'step' | 'record' | null>(null)
  const [version, setVersion] = useState(0)
  const base = `/api/actions/${card.id}/steps/${step.id}`

  useEffect(() => {
    let cancelled = false
    fetch(base)
      .then(async r => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.error ?? 'Could not load the step')
        return body as StepDetail
      })
      .then(d => {
        if (cancelled) return
        setDetail(d)
        setValues(valuesOf(d.fields))
        setRecord(d.record ? valuesOf(d.record.fields) : {})
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the step') })
    return () => { cancelled = true }
  }, [base, version])

  const stepChanges = detail ? changed(values, valuesOf(detail.fields)) : {}
  const recordChanges = detail?.record ? changed(record, valuesOf(detail.record.fields)) : {}
  const dirty = Object.keys(stepChanges).length > 0 || Object.keys(recordChanges).length > 0
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  useEffect(() => () => onDirty(false), [onDirty])

  async function saveStep() {
    setBusy('step')
    try {
      const { card: updated } = await post(base, { args: stepChanges })
      onCard(updated)
      onMessage('Step changed.')
      setVersion(v => v + 1)
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Could not save', true)
    } finally {
      setBusy(null)
    }
  }

  async function saveRecord() {
    setBusy('record')
    try {
      const { message } = await post(`${base}/record`, { values: recordChanges })
      onMessage(message ?? 'Saved.')
      setVersion(v => v + 1)
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Could not save', true)
    } finally {
      setBusy(null)
    }
  }

  if (error) return <div className="sp sp-note is-error">{error}</div>
  if (!detail) return <div className="sp sp-note">Loading…</div>

  const empty = !detail.fields.length && !detail.preview && !detail.record && !detail.note

  return (
    <div className="sp">
      {detail.note && <div className="sp-note">{detail.note}</div>}

      {detail.record && (
        <section className="sp-section">
          <div className="sp-title">{detail.record.title}</div>
          {detail.record.warnings.map(w => <div key={w} className="sp-warn">{w}</div>)}
          <Form fields={detail.record.fields} values={record} disabled={!editable || !!busy} onChange={(k, v) => setRecord(r => ({ ...r, [k]: v }))} />
          {editable && Object.keys(recordChanges).length > 0 && (
            <div className="sp-actions">
              <button type="button" className="ac-btn primary" disabled={!!busy} onClick={saveRecord}>{busy === 'record' ? 'Saving…' : 'Save to the order'}</button>
              <button type="button" className="ac-btn" disabled={!!busy} onClick={() => setRecord(valuesOf(detail.record!.fields))}>Undo changes</button>
              <span className="sp-hint">Saves on the order now, before it&apos;s lodged.</span>
            </div>
          )}
        </section>
      )}

      {detail.fields.length > 0 && (
        <section className="sp-section">
          {(detail.record || detail.preview) && <div className="sp-title">This step</div>}
          <Form fields={detail.fields} values={values} disabled={!editable || !!busy} onChange={(k, v) => setValues(r => ({ ...r, [k]: v }))} />
          {editable && Object.keys(stepChanges).length > 0 && (
            <div className="sp-actions">
              <button type="button" className="ac-btn primary" disabled={!!busy} onClick={saveStep}>{busy === 'step' ? 'Saving…' : 'Save changes'}</button>
              <button type="button" className="ac-btn" disabled={!!busy} onClick={() => setValues(valuesOf(detail.fields))}>Undo changes</button>
              <span className="sp-hint">Nothing is done until you do the step.</span>
            </div>
          )}
        </section>
      )}

      {detail.preview && (
        <section className="sp-section">
          <div className="sp-title">{detail.preview.title}</div>
          <pre className="sp-preview">{detail.preview.text}</pre>
        </section>
      )}

      {empty && <div className="sp-note">Nothing more to show for this step.</div>}
      <style>{PANEL_CSS}</style>
    </div>
  )
}

function Form({ fields, values, disabled, onChange }: {
  fields: StepField[]
  values: Values
  disabled: boolean
  onChange(key: string, value: string | boolean): void
}) {
  return (
    <div className="sp-form">
      {fields.map(f => {
        const v = values[f.key]
        const text = v === null || v === undefined ? '' : String(v)
        return (
          <label key={f.key} className={`sp-field t-${f.type}`} title={f.hint}>
            <span>{f.label}</span>
            {f.type === 'textarea' ? (
              <textarea value={text} disabled={disabled} rows={Math.min(14, Math.max(3, text.split('\n').length + 1))} onChange={e => onChange(f.key, e.target.value)} />
            ) : f.type === 'select' ? (
              <select value={text} disabled={disabled} onChange={e => onChange(f.key, e.target.value)}>
                <option value="">—</option>
                {f.options?.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
              </select>
            ) : f.type === 'checkbox' ? (
              <input type="checkbox" checked={v === true} disabled={disabled} onChange={e => onChange(f.key, e.target.checked)} />
            ) : (
              <input value={text} disabled={disabled} inputMode={f.type === 'number' ? 'decimal' : undefined}
                placeholder={f.type === 'list' ? 'Comma separated' : undefined} onChange={e => onChange(f.key, e.target.value)} />
            )}
          </label>
        )
      })}
    </div>
  )
}

const PANEL_CSS = `
  .sp { margin-top: 8px; display: flex; flex-direction: column; gap: 10px; }
  .sp-note { font-size: 12px; color: var(--subtle); }
  .sp-note.is-error { color: var(--danger-dark); }
  .sp-section { border: 0.5px solid var(--line-2); border-radius: 8px; background: var(--paper); padding: 8px 12px 10px; }
  .sp-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--subtle); margin-bottom: 6px; }
  .sp-warn { font-size: 12px; color: var(--danger-dark); background: var(--danger-bg); border-radius: 6px; padding: 4px 8px; margin-bottom: 6px; }
  .sp-form { display: flex; flex-direction: column; gap: 6px; }
  .sp-field { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--subtle); }
  .sp-field > span { width: 120px; flex-shrink: 0; }
  .sp-field.t-textarea { align-items: flex-start; }
  .sp-field.t-textarea > span { padding-top: 6px; }
  .sp-field input:not([type=checkbox]), .sp-field select, .sp-field textarea { flex: 1; min-width: 0; font: inherit; font-size: 13px; color: var(--ink); padding: 5px 8px; border: 0.5px solid var(--line-strong); border-radius: 6px; background: var(--paper); }
  .sp-field textarea { line-height: 1.5; resize: vertical; }
  .sp-field input[type=checkbox] { accent-color: var(--ink); }
  .sp-field :disabled { background: var(--surface-3); color: var(--body); }
  .sp-field input:focus, .sp-field select:focus, .sp-field textarea:focus { outline: none; border-color: var(--gold); }
  .sp-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
  .sp-actions .ac-btn { font-size: 12px; padding: 4px 12px; }
  .sp-hint { font-size: 11px; color: var(--faint); }
  .sp-preview { margin: 0; max-height: 280px; overflow: auto; font: inherit; font-size: 12px; line-height: 1.5; color: var(--body); white-space: pre-wrap; }
  @media (max-width: 560px) { .sp-field { flex-direction: column; align-items: stretch; } .sp-field > span { width: auto; } }
`
