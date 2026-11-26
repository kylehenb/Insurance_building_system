'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { Unbooked, UnbookedTrade } from '@/lib/schedule/unbooked'
import { KIND_COLOURS } from './colours'

// "Not booked yet" on the Calendar page (tech spec §23.18): inspections and
// trades that still need a date, for the same person filter as the calendar.
// From /api/schedule/unbooked — the same list as list_unbooked by voice.

const OPEN_KEY = 'irc.calendar.unbooked-open'
const shortAddress = (a: string | null) => (a ?? '').replace(/,?\s*(WA|NSW|VIC|QLD|SA|TAS|NT|ACT)\s*\d{4}\s*$/i, '').trim()
const due = (iso: string) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
const tradeText = (t: UnbookedTrade) =>
  `${t.trade}${t.business ? ` (${t.business})` : ''}${t.total_visits > 1 ? ` · visit${t.visits.length > 1 ? 's' : ''} ${t.visits.join(', ')} of ${t.total_visits}` : ''}`

export default function UnbookedPanel({ person, me }: { person: string; me: string }) {
  const [data, setData] = useState<Unbooked | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)

  const toggle = () => setOpen(o => {
    try { localStorage.setItem(OPEN_KEY, o ? '0' : '1') } catch { /* not kept */ }
    return !o
  })

  useEffect(() => {
    let live = true
    fetch(`/api/schedule/unbooked?${new URLSearchParams({ person })}`)
      .then(async res => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? 'Couldn\'t load what needs booking')
        if (!live) return
        setData(body)
        setError('')
        // Open or closed as it was last left on this device
        try { setOpen(localStorage.getItem(OPEN_KEY) === '1') } catch { /* closed */ }
      })
      .catch(err => { if (live) setError(err instanceof Error ? err.message : 'Couldn\'t load what needs booking') })
    return () => { live = false }
  }, [person])

  if (error) return <p className="rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p>
  if (!data) return null
  const ready = data.trade_jobs.filter(j => j.ready)
  const waiting = data.trade_jobs.filter(j => !j.ready)
  const overdue = data.inspections.filter(i => i.overdue).length
  if (!data.inspections.length && !data.trade_jobs.length) {
    return <p className="rounded-lg border border-ink/10 bg-white px-4 py-3 text-sm text-ink/60">Everything is booked.</p>
  }
  const owner = (j: { owner_id: string | null; owner_name: string | null }) =>
    j.owner_id && j.owner_id !== me && j.owner_name ? <span className="ml-1 rounded-full bg-cream px-2 text-xs text-ink/70">{j.owner_name}</span> : null

  return (
    <div className="rounded-lg border border-ink/10 bg-white shadow-sm">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left">
        <span className="text-sm font-semibold text-ink">Not booked yet</span>
        <span className="text-sm text-ink/60">
          {data.inspections.length} inspection{data.inspections.length === 1 ? '' : 's'}
          {overdue ? <span className="font-medium text-danger"> ({overdue} overdue)</span> : null}
          {' · '}trades on {ready.length} job{ready.length === 1 ? '' : 's'}
          {waiting.length ? ` · ${waiting.length} waiting on a signature` : ''}
        </span>
        <span className="ml-auto text-xs text-ink/50">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="grid gap-6 border-t border-ink/10 px-4 py-4 md:grid-cols-2">
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink/60">
              <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOURS.inspection }} />Inspections
            </h3>
            {data.inspections.length ? (
              <ul className="space-y-2">
                {data.inspections.map(i => (
                  <li key={i.job_id} className="text-sm">
                    <Link href={`/dashboard/jobs/${i.job_id}`} className="font-medium text-ink hover:underline">{i.job_number}</Link>
                    <span className="text-ink/70"> · {shortAddress(i.address) || 'No address'}</span>
                    {owner(i)}
                    {i.booking_due && (
                      <div className={`text-xs ${i.overdue ? 'font-medium text-danger' : 'text-ink/50'}`}>
                        Book by {due(i.booking_due)}{i.overdue ? ' — overdue' : ''}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink/40">None to book.</p>}
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink/60">
              <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOURS.repair }} />Trades
            </h3>
            {ready.length ? (
              <ul className="space-y-3">
                {ready.map(j => (
                  <li key={j.job_id} className="text-sm">
                    <Link href={`/dashboard/jobs/${j.job_id}`} className="font-medium text-ink hover:underline">{j.job_number}</Link>
                    <span className="text-ink/70"> · {shortAddress(j.address) || 'No address'}</span>
                    {owner(j)}
                    <ul className="mt-1 space-y-0.5">
                      {j.trades.map(t => (
                        <li key={t.work_order_id} className="text-xs text-ink/70">
                          {tradeText(t)}{!t.sent && <span className="ml-1 text-warning-dark">· not sent yet</span>}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink/40">None on jobs ready for work.</p>}
            {waiting.length > 0 && (
              <p className="mt-3 text-xs text-ink/50">
                Waiting on the homeowner&apos;s signature first:{' '}
                {waiting.map((j, n) => (
                  <span key={j.job_id}>{n ? ', ' : ''}<Link href={`/dashboard/jobs/${j.job_id}`} className="hover:underline">{j.job_number}</Link></span>
                ))}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
