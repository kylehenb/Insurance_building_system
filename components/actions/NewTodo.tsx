'use client'

import { useMemo, useState } from 'react'
import { JobSearch } from '@/components/mail/Composer'
import { followUpDay, spokenDue } from '@/lib/actions/followups'
import { isoToPerthLocal, perthLocalToIso } from '@/lib/mail/schedule-rules'
import type { JobHit } from '@/lib/mail/job-context'
import { REMIND_CSS } from './RemindMe'

// + To-do: something to do that didn't come from an email — someone rang, an
// idea, a job to remember. In the person's own words, on a job or not, now
// or on a day (and a time, if it matters). "Just remind me" puts it on the
// list as it is; "Have IRC draft the steps" has the AI work out the email,
// work order or document that does it when it comes up. It stays until
// they clear it (lib/actions/followups.ts).

interface Props {
  /** On a job page: that job, fixed */
  jobId?: string | null
  jobNumber?: string | null
  onDone(message: string): void
  onError(message: string): void
  onCancel(): void
}

type When = { label: string; day: string | null }

const DAY_MS = 86_400_000

export function NewTodo({ jobId, jobNumber, onDone, onError, onCancel }: Props) {
  const today = isoToPerthLocal(new Date().toISOString()).slice(0, 10)
  const choices = useMemo<When[]>(() => {
    const plus = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
    return [{ label: 'Now', day: null }, { label: 'Tomorrow', day: plus(1) }, { label: 'In 3 days', day: plus(3) }, { label: 'In a week', day: plus(7) }]
  }, [today])
  const [note, setNote] = useState('')
  const [day, setDay] = useState<string | null>(null)
  const [time, setTime] = useState('')
  const [mode, setMode] = useState<'remind' | 'do'>('remind')
  const [urgent, setUrgent] = useState(false)
  const [job, setJob] = useState<{ id: string; job_number: string } | null>(jobId ? { id: jobId, job_number: jobNumber ?? '' } : null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)

  // A day at 8am, or the time given; nothing is "now"
  const dueAt = day ? (time ? perthLocalToIso(`${day}T${time}`) : followUpDay(day)) : null
  const whenText = dueAt ? `Comes onto your action cards ${spokenDue(dueAt)}${time ? '' : ', 8am'}` : 'Goes on your action cards now'

  async function save() {
    setBusy(true)
    try {
      const res = await fetch('/api/followups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ todo: mode, note, dueAt: dueAt ?? '', jobId: job?.id ?? null, urgent }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not add the to-do')
      onDone(dueAt ? `To-do added for ${spokenDue(dueAt)}.` : mode === 'do' ? 'To-do added — IRC is drafting the steps.' : 'To-do added.')
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not add the to-do')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rm td" onKeyDown={e => e.stopPropagation()}>
      <div className="rm-title">New to-do</div>
      <textarea autoFocus value={note} rows={2} onChange={e => setNote(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && note.trim() && !busy) { e.preventDefault(); void save() } }}
        placeholder="What needs doing? e.g. Ring Brett about the excess — he said to call after 3" />
      <div className="rm-row">
        {job && !picking ? (
          <span className="rm-job">{job.job_number || 'This job'}{!jobId && <button title="Not about this job" onClick={() => setJob(null)}>✕</button>}</span>
        ) : picking ? (
          <JobSearch onPick={(hit: JobHit) => { setJob({ id: hit.id, job_number: hit.job_number }); setPicking(false) }} onCancel={() => setPicking(false)} />
        ) : (
          <button className="rm-link" onClick={() => setPicking(true)}>+ Job (optional)</button>
        )}
      </div>
      <div className="rm-row rm-when">
        {choices.map(c => (
          <button key={c.label} className={day === c.day ? 'on' : ''} onClick={() => { setDay(c.day); if (!c.day) setTime('') }}>{c.label}</button>
        ))}
        <input type="date" value={day ?? ''} min={today} onChange={e => setDay(e.target.value || null)} aria-label="On a day" />
        {day && <input type="time" value={time} onChange={e => setTime(e.target.value)} aria-label="At a time (optional)" />}
      </div>
      <div className="rm-row td-mode" role="radiogroup" aria-label="What IRC does">
        <label><input type="radio" checked={mode === 'remind'} onChange={() => setMode('remind')} /> Just remind me</label>
        <label><input type="radio" checked={mode === 'do'} onChange={() => setMode('do')} /> Have IRC draft the steps</label>
        <label className="td-urgent"><input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} /> Urgent</label>
      </div>
      <div className="rm-row">
        <span className="rm-due">
          {whenText}{mode === 'do' ? ', with the email or other steps drafted for you to check.' : ', just as you wrote it.'} It stays until you clear it.
        </span>
      </div>
      <div className="rm-row">
        <button className="ac-btn primary" disabled={busy || !note.trim()} onClick={save}>{busy ? 'Adding…' : 'Add to-do'}</button>
        <button className="ac-btn" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
      <style>{REMIND_CSS}{TODO_CSS}</style>
    </div>
  )
}

const TODO_CSS = `
  .td { margin: 0 0 12px; background: var(--paper); }
  .td-mode label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--grey-600); cursor: pointer; }
  .td-mode input { accent-color: var(--ink); }
  .td-urgent { margin-left: auto; }
  .td input[type=time] { width: 110px; }
`
