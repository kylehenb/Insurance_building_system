'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { CardWithContext } from '@/lib/actions/cards'
import { followUpDay, followUpPresets, spokenDue } from '@/lib/actions/followups'
import { isoToPerthLocal } from '@/lib/mail/schedule-rules'
import { REMIND_CSS, RemindMe } from './RemindMe'

// Follow-ups waiting for their date — all of them (Action cards → Follow-ups)
// or one job's (the job page). Each can be moved, reworded or cancelled; on
// the day it becomes an action card with the chase drafted.

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong')
  return data
}

export function FollowUps({ jobId, jobNumber, version = 0, onMessage, showNew = true, compact }: {
  jobId?: string
  jobNumber?: string | null
  version?: number
  onMessage(text: string, error?: boolean): void
  showNew?: boolean
  /** On the job page: no empty state, a smaller heading */
  compact?: boolean
}) {
  const [items, setItems] = useState<CardWithContext[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    send(`/api/followups${jobId ? `?job=${jobId}` : ''}`, 'GET')
      .then(data => { if (!cancelled) { setItems(data.followUps); setError(null) } })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load follow-ups') })
    return () => { cancelled = true }
  }, [jobId, version, reload])

  async function cancel(id: string) {
    try {
      await send(`/api/followups/${id}`, 'DELETE')
      onMessage('Follow-up cancelled.')
      setReload(r => r + 1)
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Could not cancel', true)
    }
  }

  if (compact && !adding && items && !items.length) {
    return showNew ? <button className="fu-new" onClick={() => setAdding(true)}>⏰ Remind me…</button> : null
  }

  return (
    <div className={`fu${compact ? ' compact' : ''}`}>
      <div className="fu-head">
        <span className="fu-title">{compact ? 'Follow-ups' : 'Coming up'}</span>
        {showNew && !adding && <button className="fu-new" onClick={() => setAdding(true)}>⏰ Remind me…</button>}
      </div>
      {adding && (
        <RemindMe
          jobId={jobId}
          jobNumber={jobNumber}
          onDone={text => { onMessage(text); setAdding(false); setReload(r => r + 1) }}
          onError={text => onMessage(text, true)}
          onCancel={() => setAdding(false)}
        />
      )}
      {error && <div className="fu-empty is-error">{error}</div>}
      {!items && !error && <div className="fu-empty">Loading…</div>}
      {items?.length === 0 && !adding && (
        <div className="fu-empty">No follow-ups coming up. Use Remind me on a card or a job to have something come back on a day.</div>
      )}
      {items?.map(f => editing === f.id ? (
        <EditFollowUp key={f.id} item={f} onMessage={onMessage} onClose={changed => { setEditing(null); if (changed) setReload(r => r + 1) }} />
      ) : (
        <div key={f.id} className="fu-row">
          <span className="fu-when">{f.due_at ? spokenDue(f.due_at) : ''}</span>
          <span className="fu-what">
            {f.follow_up?.waiting ? `Waiting on ${f.follow_up.waiting.name}: ${f.follow_up.waiting.asked}` : f.follow_up?.note ?? f.title}
            <span className="fu-sub">
              {f.follow_up?.waiting ? <>set by IRC{f.follow_up_for ? ` for ${f.follow_up_for}` : ''}</> : f.follow_up?.who && <>with {f.follow_up.who}</>}
              {f.conversation?.subject && <>{f.follow_up?.who ? ' · ' : ''}re “{f.conversation.subject}”</>}
            </span>
          </span>
          {!jobId && f.job && <Link href={`/dashboard/jobs/${f.job.id}`} className="ac-job">{f.job.job_number}</Link>}
          <span className="fu-btns">
            <button className="ac-link" onClick={() => setEditing(f.id)}>Change</button>
            <button className="ac-link" onClick={() => cancel(f.id)}>Cancel</button>
          </span>
        </div>
      ))}
      <style>{`
        .fu { background: var(--paper); border: 0.5px solid var(--line-2); border-radius: 10px; padding: 12px 16px; margin-bottom: 12px; font-size: 13px; color: var(--body); }
        .fu.compact { margin-top: 12px; }
        .fu-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
        .fu-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--subtle); }
        .fu-new { font: inherit; font-size: 12px; color: var(--ink); background: var(--paper); border: 0.5px solid var(--line-strong); border-radius: 14px; padding: 3px 12px; cursor: pointer; }
        .fu-new:hover { border-color: var(--gold); }
        .fu-empty { font-size: 12px; color: var(--faint); padding: 6px 0; }
        .fu-empty.is-error { color: var(--danger-dark); }
        .fu-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-top: 0.5px solid var(--line-faint); }
        .fu-when { width: 92px; flex-shrink: 0; font-size: 12px; font-weight: 600; color: var(--ink); }
        .fu-what { flex: 1; min-width: 0; color: var(--ink); overflow-wrap: anywhere; }
        .fu-sub { display: block; font-size: 11px; color: var(--subtle); }
        .fu-btns { display: flex; gap: 12px; flex-shrink: 0; }
        .fu .ac-job { font-size: 11px; font-weight: 700; color: var(--teal); background: var(--success-bg-2); border: 0.5px solid #cfe5d8; border-radius: 10px; padding: 1px 8px; text-decoration: none; }
        .fu .ac-link { font: inherit; font-size: 12px; color: var(--info); background: none; border: none; padding: 0; cursor: pointer; }
        @media (max-width: 560px) { .fu-row { flex-wrap: wrap; } .fu-when { width: auto; } }
      `}</style>
    </div>
  )
}

function EditFollowUp({ item, onMessage, onClose }: { item: CardWithContext; onMessage(text: string, error?: boolean): void; onClose(changed: boolean): void }) {
  const presets = followUpPresets()
  const [note, setNote] = useState(item.follow_up?.note ?? '')
  const [who, setWho] = useState(item.follow_up?.who ?? '')
  const [dueAt, setDueAt] = useState(item.due_at ?? presets[1].at)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await send(`/api/followups/${item.id}`, 'POST', { note, who: who.trim() || null, ...(dueAt !== item.due_at ? { dueAt } : {}) })
      onMessage(`Follow-up now ${spokenDue(dueAt)}.`)
      onClose(true)
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Could not change it', true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rm" style={{ marginTop: 6 }}>
      <textarea value={note} rows={2} onChange={e => setNote(e.target.value)} />
      <div className="rm-row"><label className="rm-who">With <input value={who} onChange={e => setWho(e.target.value)} placeholder="optional" /></label></div>
      <div className="rm-row rm-when">
        {presets.map(p => <button key={p.label} className={dueAt === p.at ? 'on' : ''} onClick={() => setDueAt(p.at)}>{p.label}</button>)}
        <input type="date" value={isoToPerthLocal(dueAt).slice(0, 10)} onChange={e => { const at = e.target.value && followUpDay(e.target.value); if (at) setDueAt(at) }} />
      </div>
      <div className="rm-row">
        <button className="ac-btn primary" disabled={busy || !note.trim()} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="ac-btn" disabled={busy} onClick={() => onClose(false)}>Cancel</button>
      </div>
      <style>{REMIND_CSS}</style>
    </div>
  )
}
