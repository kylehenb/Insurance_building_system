'use client'

import { useMemo, useState } from 'react'
import { JobSearch } from '@/components/mail/Composer'
import { followUpDay, followUpPresets, spokenDue } from '@/lib/actions/followups'
import { isoToPerthLocal } from '@/lib/mail/schedule-rules'
import type { JobHit } from '@/lib/mail/job-context'

// Remind me: set a follow-up — what, who with, and when (3 days, a week, two
// weeks, a month or a date). On the day it comes onto the action cards with
// the chase drafted (lib/actions/followups.ts). From a card it's about that
// card's job and email, and can take the card off the list until then.

interface Props {
  note?: string
  who?: string | null
  /** The job it's about; without one (and no card) the person can pick one */
  jobId?: string | null
  jobNumber?: string | null
  threadId?: string | null
  fromCardId?: string | null
  /** Offer to take the card it's set from off the list until then */
  canClear?: boolean
  onDone(message: string, cleared: boolean): void
  onError(message: string): void
  onCancel(): void
}

export function RemindMe({ note: startNote = '', who: startWho = '', jobId, jobNumber, threadId, fromCardId, canClear, onDone, onError, onCancel }: Props) {
  const presets = useMemo(() => followUpPresets(), [])
  const [note, setNote] = useState(startNote)
  const [who, setWho] = useState(startWho ?? '')
  const [dueAt, setDueAt] = useState<string>(presets[1].at)
  const [clear, setClear] = useState(!!canClear)
  const [job, setJob] = useState<{ id: string; job_number: string } | null>(jobId ? { id: jobId, job_number: jobNumber ?? '' } : null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const day = isoToPerthLocal(dueAt).slice(0, 10)
  const today = isoToPerthLocal(new Date().toISOString()).slice(0, 10)

  async function save() {
    setBusy(true)
    try {
      const res = await fetch('/api/followups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note, who: who.trim() || null, dueAt, jobId: job?.id ?? null, threadId: threadId ?? null, fromCardId: fromCardId ?? null, clearCard: !!canClear && clear }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not set the follow-up')
      onDone(`Follow-up set for ${spokenDue(dueAt)}.`, !!canClear && clear)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not set the follow-up')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rm" onKeyDown={e => e.stopPropagation()}>
      <div className="rm-title">Remind me</div>
      <textarea autoFocus value={note} rows={2} onChange={e => setNote(e.target.value)}
        placeholder="What to follow up, e.g. Chase the roof quote — they said Friday" />
      <div className="rm-row">
        <label className="rm-who">With <input value={who} onChange={e => setWho(e.target.value)} placeholder="e.g. Ace Roofing (optional)" /></label>
        {!fromCardId && (
          job && !picking ? (
            <span className="rm-job">{job.job_number || 'This job'}{!jobId && <button title="Not about this job" onClick={() => setJob(null)}>✕</button>}</span>
          ) : picking ? (
            <JobSearch onPick={(hit: JobHit) => { setJob({ id: hit.id, job_number: hit.job_number }); setPicking(false) }} onCancel={() => setPicking(false)} />
          ) : (
            <button className="rm-link" onClick={() => setPicking(true)}>+ Job</button>
          )
        )}
      </div>
      <div className="rm-row rm-when">
        {presets.map(p => (
          <button key={p.label} className={dueAt === p.at ? 'on' : ''} onClick={() => setDueAt(p.at)}>{p.label}</button>
        ))}
        <input type="date" value={day} min={today} onChange={e => { const at = e.target.value && followUpDay(e.target.value); if (at) setDueAt(at) }} />
      </div>
      <div className="rm-row">
        <span className="rm-due">Comes onto your action cards {spokenDue(dueAt)}, 8am, with the chase drafted for you to check.</span>
      </div>
      {canClear && (
        <label className="rm-clear"><input type="checkbox" checked={clear} onChange={e => setClear(e.target.checked)} /> Take this card off the list until then</label>
      )}
      <div className="rm-row">
        <button className="ac-btn primary" disabled={busy || !note.trim()} onClick={save}>{busy ? 'Setting…' : 'Set follow-up'}</button>
        <button className="ac-btn" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
      <style>{REMIND_CSS}</style>
    </div>
  )
}

/** Also used by the follow-up list's Change form */
export const REMIND_CSS = `
        .rm { margin-top: 12px; padding: 10px 12px; border: 0.5px solid var(--line-2); border-radius: 8px; background: var(--surface-3); display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
        .rm-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--subtle); }
        .rm textarea, .rm input:not([type=checkbox]) { font: inherit; font-size: 13px; color: var(--ink); padding: 5px 8px; border: 0.5px solid var(--line-strong); border-radius: 6px; background: var(--paper); }
        .rm textarea { line-height: 1.5; resize: vertical; }
        .rm textarea:focus, .rm input:focus { outline: none; border-color: var(--gold); }
        .rm-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; position: relative; }
        .rm-who { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 200px; font-size: 12px; color: var(--subtle); }
        .rm-who input { flex: 1; min-width: 0; }
        .rm-job { font-size: 11px; font-weight: 700; color: var(--teal); background: var(--success-bg-2); border: 0.5px solid #cfe5d8; border-radius: 10px; padding: 1px 8px; }
        .rm-job button { background: none; border: none; color: var(--teal); font-size: 10px; cursor: pointer; padding: 0 0 0 5px; }
        .rm-link, .rm .cmp-link { font: inherit; font-size: 12px; color: var(--grey-600); background: none; border: none; cursor: pointer; padding: 0; }
        .rm-when button { font: inherit; font-size: 12px; color: var(--ink); background: var(--paper); border: 0.5px solid var(--line-strong); border-radius: 14px; padding: 3px 10px; cursor: pointer; }
        .rm-when button.on { background: var(--ink); color: var(--cream); border-color: var(--ink); }
        .rm-due { font-size: 11px; color: var(--faint); }
        .rm-clear { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--grey-600); cursor: pointer; }
        .rm-clear input { accent-color: var(--ink); }
        .rm .ac-btn { font-size: 12px; padding: 4px 12px; }
        .rm .cmp-jobsearch { position: relative; display: flex; align-items: center; gap: 8px; flex: 1; min-width: 220px; }
        .rm .cmp-jobsearch input { flex: 1; min-width: 0; }
        .rm .cmp-suggest { position: absolute; left: 0; top: 100%; z-index: 5; min-width: 300px; background: var(--paper); border: 0.5px solid var(--line-strong); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.15); padding: 4px 0; }
        .rm .cmp-suggest button { display: flex; flex-direction: column; align-items: flex-start; width: 100%; font: inherit; font-size: 13px; text-align: left; background: none; border: none; padding: 6px 12px; cursor: pointer; }
        .rm .cmp-suggest button span { font-size: 12px; color: var(--subtle); }
        .rm .cmp-suggest button.on, .rm .cmp-suggest button:hover { background: var(--surface-2); }
      `
