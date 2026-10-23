'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { ActivityOutcome, ActivityVia, ActivityView } from '@/lib/activity/log'

// Settings → Activity: the who-did-what log (lib/activity) — sends, lodging,
// stage and excess changes, voice calls, approvals. Everyone's for people who
// may manage users; otherwise your own.

interface ActivityData { entries: ActivityView[]; seesEveryone: boolean }
interface Person { id: string; name: string }

const VIA_LABEL: Record<ActivityVia, string> = { app: 'App', voice: 'Voice', approval: 'On approval' }
const OUTCOME: Record<ActivityOutcome, { label: string; className: string }> = {
  done: { label: 'Done', className: 'text-[#2d6a4f]' },
  failed: { label: 'Failed', className: 'text-[#9f1239]' },
  requested: { label: 'Asked for approval', className: 'text-[#92400e]' },
  rejected: { label: 'Rejected', className: 'text-[#9f1239]' },
  cancelled: { label: 'Cancelled', className: 'text-subtle' },
}
const DAY_OPTIONS = [1, 7, 30, 90]

const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export default function ActivityPage() {
  const [data, setData] = useState<ActivityData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [userId, setUserId] = useState('')
  const [days, setDays] = useState(7)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const q = new URLSearchParams({ days: String(days), ...(userId ? { userId } : {}) })
    fetch(`/api/activity?${q}`)
      .then(async res => ({ ok: res.ok, json: await res.json().catch(() => ({})) }))
      .then(({ ok, json }) => {
        if (!live) return
        if (ok) setData(json as ActivityData)
        setError(ok ? null : json.error ?? 'Could not load activity')
      })
    return () => { live = false }
  }, [days, userId])

  const seesEveryone = data?.seesEveryone ?? false
  useEffect(() => {
    if (!seesEveryone) return
    let live = true
    fetch('/api/settings/permissions')
      .then(res => (res.ok ? res.json() : { users: [] }))
      .then((d: { users?: Person[] }) => { if (live) setPeople(d.users ?? []) })
    return () => { live = false }
  }, [seesEveryone])

  if (!data) return <div className="p-8 text-sm text-subtle">{error ?? 'Loading…'}</div>

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <a href="/dashboard/settings" className="text-xs text-subtle hover:text-ink">← Settings</a>
        <h1 className="text-2xl font-semibold text-ink mt-1">Activity</h1>
        <p className="text-sm text-subtle mt-1">
          Who sent, lodged, changed or approved what — in the app, by voice, or run once approved.
          {!data.seesEveryone && ' You can see your own activity.'}
        </p>
        {error && <p className="text-sm text-[#9f1239] mt-2">{error}</p>}
      </div>

      <div className="flex gap-3 mb-4">
        {data.seesEveryone && (
          <select value={userId} onChange={e => setUserId(e.target.value)} className="border border-line-3 rounded px-2 py-1 text-sm bg-white">
            <option value="">Everyone</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <select value={days} onChange={e => setDays(Number(e.target.value))} className="border border-line-3 rounded px-2 py-1 text-sm bg-white">
          {DAY_OPTIONS.map(d => <option key={d} value={d}>{d === 1 ? 'Last 24 hours' : `Last ${d} days`}</option>)}
        </select>
      </div>

      <div className="bg-white border border-line-3 rounded-lg divide-y divide-line-3">
        {data.entries.length === 0 && <div className="px-4 py-6 text-sm text-subtle text-center">Nothing in this period.</div>}
        {data.entries.map(e => (
          <div key={e.id} className="px-4 py-3">
            <div className="flex items-start gap-4">
              <div className="w-36 shrink-0 text-xs text-subtle pt-0.5">{when(e.createdAt)}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-ink">{e.summary}</div>
                <div className="text-xs text-subtle mt-0.5">
                  {e.user.name ?? 'Unknown'} · {VIA_LABEL[e.via]}{e.voiceKeyLabel && ` (${e.voiceKeyLabel})`}
                  {e.approvedBy && ` · approved by ${e.approvedBy}`}
                  {e.job && <> · <Link href={`/dashboard/jobs/${e.job.id}`} className="text-tan hover:underline">{e.job.number ?? 'Job'}</Link></>}
                  {e.detail && <> · <button onClick={() => setOpen(open === e.id ? null : e.id)} className="text-tan hover:underline">{open === e.id ? 'Hide details' : 'Details'}</button></>}
                </div>
                {open === e.id && e.detail && <div className="text-xs text-subtle mt-2 whitespace-pre-wrap">{e.detail}</div>}
              </div>
              <div className={`text-xs shrink-0 ${OUTCOME[e.outcome].className}`}>{OUTCOME[e.outcome].label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
