'use client'

import { useState } from 'react'
import { perthDate } from '@/lib/schedule/schedule'

// Book or move from the Calendar page (tech spec §23.18): a trade's day(s) on
// site — all day unless a start time is given, a last day for work over
// several days — or an inspection at a time. Saved through the same shared
// functions as booking by voice.

export type BookingTarget =
  | { mode: 'trade'; work_order_id: string; visit_number?: number; label: string; job_number: string; start_date?: string; end_date?: string | null; start_time?: string | null }
  | { mode: 'inspection'; job_id: string; inspection_id?: string; label: string; job_number: string; start_date?: string; start_time?: string | null; minutes?: number }

const input = 'w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink'

export default function BookingDialog({ target, onClose, onDone }: { target: BookingTarget; onClose: () => void; onDone: () => void }) {
  const moving = !!target.start_date
  const [date, setDate] = useState(target.start_date ?? perthDate())
  const [several, setSeveral] = useState(target.mode === 'trade' && !!target.end_date)
  const [endDate, setEndDate] = useState(target.mode === 'trade' ? target.end_date ?? '' : '')
  const [time, setTime] = useState(target.start_time ?? (target.mode === 'inspection' ? '08:00' : ''))
  const [minutes, setMinutes] = useState(target.mode === 'inspection' ? target.minutes ?? 60 : 60)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const [url, body] = target.mode === 'trade'
      ? ['/api/schedule/trade-visit', {
          work_order_id: target.work_order_id, visit_number: target.visit_number, start_date: date,
          end_date: several && endDate ? endDate : undefined, start_time: time || undefined, all_day: !time, note: note || undefined,
        }]
      : ['/api/schedule/inspection', { job_id: target.job_id, inspection_id: target.inspection_id, start: `${date}T${time}`, minutes, note: note || undefined }]
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(out.error ?? 'Couldn\'t save the booking')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn\'t save the booking')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <form
        onSubmit={save}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
        role="dialog"
        aria-label={`${moving ? 'Move' : 'Book'} ${target.label}`}
      >
        <h2 className="text-lg font-semibold text-ink">{moving ? 'Move' : 'Book'} {target.label}</h2>
        <p className="mt-0.5 text-sm text-ink/60">{target.job_number}</p>

        <div className="mt-4 space-y-3">
          <label className="block text-sm text-ink/70">
            {target.mode === 'trade' && several ? 'First day' : 'Day'}
            <input type="date" required value={date} onChange={e => setDate(e.target.value)} className={`mt-1 ${input}`} />
          </label>

          {target.mode === 'trade' && (
            <>
              <label className="flex items-center gap-2 text-sm text-ink/70">
                <input type="checkbox" checked={several} onChange={e => setSeveral(e.target.checked)} />
                Over several days
              </label>
              {several && (
                <label className="block text-sm text-ink/70">
                  Last day
                  <input type="date" required min={date} value={endDate} onChange={e => setEndDate(e.target.value)} className={`mt-1 ${input}`} />
                </label>
              )}
            </>
          )}

          <label className="block text-sm text-ink/70">
            {target.mode === 'trade' ? 'Start time (leave empty for all day)' : 'Time'}
            <div className="mt-1 flex gap-2">
              <input type="time" required={target.mode === 'inspection'} value={time} onChange={e => setTime(e.target.value)} className={input} />
              {target.mode === 'trade' && time && (
                <button type="button" onClick={() => setTime('')} className="shrink-0 rounded-lg border border-ink/15 px-3 text-sm text-ink/70 hover:bg-cream">All day</button>
              )}
            </div>
          </label>

          {target.mode === 'inspection' && (
            <label className="block text-sm text-ink/70">
              How long
              <select value={minutes} onChange={e => setMinutes(Number(e.target.value))} className={`mt-1 ${input}`}>
                {[30, 45, 60, 90, 120, 180].map(m => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`}</option>)}
              </select>
            </label>
          )}

          <label className="block text-sm text-ink/70">
            Note <span className="text-ink/40">(optional)</span>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder={target.mode === 'trade' ? 'e.g. key in lockbox' : 'e.g. side gate, dog in the yard'} className={`mt-1 ${input}`} />
          </label>
          {target.mode === 'inspection' && <p className="text-xs text-ink/50">Goes in your calendar with directions and the field app link.</p>}
        </div>

        {error && <p className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-ink/15 px-4 py-2 text-sm text-ink hover:bg-cream">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-ink px-4 py-2 text-sm text-cream hover:bg-ink-hover disabled:opacity-60">
            {saving ? 'Saving…' : moving ? 'Move' : 'Book'}
          </button>
        </div>
      </form>
    </div>
  )
}
