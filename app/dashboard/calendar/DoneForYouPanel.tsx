'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { AutoAction } from '@/lib/automation/auto-bookings'

// Done for you on the Calendar page (tech spec §23.19): trades' days IRC put on
// the schedule by itself from emails the office sent, with the words it went
// on and one-tap Undo (a reason, if given, teaches it). Hidden when there's
// nothing in the last two weeks.

type Row = AutoAction & { job_number: string | null }
const when = (iso: string) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

export default function DoneForYouPanel({ refresh, onChanged }: { refresh: number; onChanged: () => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState('')

  useEffect(() => {
    let live = true
    fetch('/api/auto-actions')
      .then(res => (res.ok ? res.json() : { actions: [] }))
      .then(body => { if (live) setRows(body.actions ?? []) })
      .catch(() => { /* the panel just stays hidden */ })
    return () => { live = false }
  }, [refresh])

  async function undo(r: Row) {
    const reason = window.prompt(`Undo: ${r.summary}?\n\nWhy was it wrong? (optional — it helps IRC learn)`, '')
    if (reason === null) return
    setBusy(r.id)
    const res = await fetch('/api/auto-actions/undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, reason: reason || undefined }) })
    const out = await res.json().catch(() => ({}))
    setBusy('')
    if (!res.ok) { window.alert(out.error ?? 'Couldn\'t undo it'); return }
    onChanged()
  }

  if (!rows.length) return null
  return (
    <div className="rounded-lg border border-ink/10 bg-white px-4 py-3 shadow-sm">
      <h3 className="text-sm font-semibold text-ink">Done for you <span className="font-normal text-ink/50">· from your emails, last two weeks</span></h3>
      <ul className="mt-2 space-y-2">
        {rows.map(r => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className={r.status === 'undone' ? 'text-ink/40 line-through' : 'text-ink'}>
              {r.job_id ? <Link href={`/dashboard/jobs/${r.job_id}`} className="hover:underline">{r.summary}</Link> : r.summary}
            </span>
            <span className="text-xs text-ink/50">{when(r.created_at)}</span>
            {r.evidence && <span className="w-full text-xs italic text-ink/50">You wrote: &ldquo;{r.evidence}&rdquo;</span>}
            {r.status === 'done'
              ? <button type="button" disabled={busy === r.id} onClick={() => undo(r)} className="rounded-md border border-ink/15 px-2 py-0.5 text-xs text-ink hover:bg-cream disabled:opacity-50">Undo</button>
              : <span className="text-xs text-ink/40">Undone</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
