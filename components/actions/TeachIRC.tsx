'use client'

import { useState } from 'react'
import type { DebriefPoint } from '@/lib/learning/debrief'

// Teaching IRC from a card (tech spec §24.8): what you say — why it was right
// or wrong, how you work, what to do next time — is turned into a few
// takeaways that work from the next card on. They show here straight away;
// reword or remove any that it got wrong. Saying nothing is fine: a plain
// confirm or skip still counts.

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong')
  return data
}

/** Sends what was said about a card; returns the takeaways */
export async function teachCard(cardId: string, comment: string): Promise<DebriefPoint[]> {
  if (!comment.trim()) return []
  const { takeaways } = await post(`/api/actions/${cardId}/teach`, { comment })
  return takeaways ?? []
}

/** The takeaways, each with Reword and Remove */
export function GotIt({ points, onChange }: { points: DebriefPoint[]; onChange: (points: DebriefPoint[]) => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [when, setWhen] = useState('')
  const [error, setError] = useState('')
  if (!points.length) return null

  async function save(p: DebriefPoint) {
    try {
      await post(`/api/learning/taught/${p.id}`, { lesson: text, applies_when: when })
      onChange(points.map(x => (x.id === p.id ? { ...x, lesson: text.trim() || x.lesson, applies_when: when.trim() || x.applies_when } : x)))
      setEditing(null)
    } catch (err) { setError(err instanceof Error ? err.message : 'Couldn\'t save it') }
  }
  async function remove(p: DebriefPoint) {
    try {
      await post(`/api/learning/taught/${p.id}`, { remove: true })
      onChange(points.filter(x => x.id !== p.id))
    } catch (err) { setError(err instanceof Error ? err.message : 'Couldn\'t remove it') }
  }

  return (
    <div className="teach-got">
      <div className="teach-got-head">Got it — from now on:</div>
      <ul>
        {points.map(p => (
          <li key={p.id}>
            {editing === p.id ? (
              <div className="teach-edit">
                <textarea value={text} onChange={e => setText(e.target.value)} rows={2} />
                <input value={when} onChange={e => setWhen(e.target.value)} placeholder="When it applies" />
                <div>
                  <button className="ac-btn primary" onClick={() => save(p)}>Save</button>
                  <button className="ac-btn ghost" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <span className="teach-lesson">{p.lesson}</span>
                <span className="teach-when">When: {p.applies_when}{p.shared ? ' · everywhere IRC writes' : ''}{p.replaced ? ' · updated an earlier one' : ''}</span>
                <span className="teach-acts">
                  <button className="ac-link" onClick={() => { setEditing(p.id); setText(p.lesson); setWhen(p.applies_when) }}>Reword</button>
                  <button className="ac-link" onClick={() => remove(p)}>Remove</button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      {error && <div className="ac-error">{error}</div>}
      <style>{TEACH_CSS}</style>
    </div>
  )
}

/** The Tell IRC box: what you say goes with Do or Skip, or on its own with Save */
export function TellIRC({ cardId, value, onValue, busy, onTaught, onError, onClose }: {
  cardId: string; value: string; onValue: (v: string) => void; busy: boolean
  onTaught: (points: DebriefPoint[]) => void; onError: (text: string) => void; onClose: () => void
}) {
  const [saving, setSaving] = useState(false)
  async function save() {
    setSaving(true)
    try {
      const points = await teachCard(cardId, value)
      onValue('')
      onTaught(points)
      if (!points.length) onError('Nothing general to take from that — it\'s noted against this card.')
    } catch (err) { onError(err instanceof Error ? err.message : 'Couldn\'t save it') }
    setSaving(false)
  }
  return (
    <div className="ac-ask">
      <textarea
        autoFocus
        value={value}
        onChange={e => onValue(e.target.value)}
        rows={3}
        placeholder="Tell IRC why — what was right or wrong, how you work, what to do next time. e.g. Dave's casual, keep it short and first-name. Whenever a trade confirms a day, let the homeowner know too."
      />
      <div className="ac-ask-btns">
        <button className="ac-btn primary" disabled={busy || saving || !value.trim()} onClick={save}>{saving ? 'Taking it in…' : 'Teach IRC'}</button>
        <button className="ac-btn" disabled={saving} onClick={onClose}>Close</button>
        <span className="ac-ask-note">Or leave it here and press Do or Skip: it goes with it.</span>
      </div>
      <style>{TEACH_CSS}</style>
    </div>
  )
}

const TEACH_CSS = `
  .teach-got { margin-top: 10px; background: var(--success-bg-2); border: 0.5px solid #cfe5d8; border-radius: 8px; padding: 8px 10px; }
  .teach-got-head { font-size: 12px; font-weight: 600; color: var(--teal); }
  .teach-got ul { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .teach-got li { display: flex; flex-direction: column; gap: 1px; }
  .teach-lesson { font-size: 13px; color: var(--ink); line-height: 1.4; }
  .teach-when { font-size: 11px; color: var(--subtle); }
  .teach-acts { display: flex; gap: 12px; }
  .teach-edit { display: flex; flex-direction: column; gap: 6px; }
  .teach-edit textarea, .teach-edit input { font: inherit; font-size: 13px; padding: 6px 8px; border: 0.5px solid var(--line-strong); border-radius: 6px; background: var(--paper); }
  .teach-edit > div { display: flex; gap: 6px; }
`
