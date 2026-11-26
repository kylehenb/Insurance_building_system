'use client'

import Link from 'next/link'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { KIND_LABELS, SCHEDULE_KINDS, addDays, perthDate, type ScheduleEntry, type ScheduleKind } from '@/lib/schedule/schedule'
import { mapsLink } from '@/lib/maps'
import UnbookedPanel from './UnbookedPanel'
import DoneForYouPanel from './DoneForYouPanel'
import BookingDialog, { type BookingTarget } from './BookingDialog'
import { KIND_COLOURS } from './colours'

// The Calendar page (tech spec §23.18): everything on IRC's jobs — inspections
// by kind, trades on site, job appointments — by day, week or month, from
// /api/schedule (the same schedule get_schedule reads out by voice). Colour
// says what it is; the filters say which and whose, and stack.

type View = 'day' | 'week' | 'month'
type Person = { id: string; name: string | null }
type DayEntry = ScheduleEntry & { day_of?: { day: number; days: number } }

const SHORT_LABELS: Record<ScheduleKind, string> = { ...KIND_LABELS, repair: 'Trades on site', appointment: 'Meetings' }

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const STORE_KEY = 'irc.calendar'

const dayOfWeek = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7 // Mon 0 … Sun 6
const monday = (d: string) => addDays(d, -dayOfWeek(d))
const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', ...o }).format(new Date(`${d}T00:00:00Z`))
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
const shortAddress = (a: string | null) => (a ?? '').replace(/,?\s*(WA|NSW|VIC|QLD|SA|TAS|NT|ACT)\s*\d{4}\s*$/i, '').trim()
const suburb = (a: string | null) => shortAddress(a).split(',').map(s => s.trim()).filter(Boolean).at(-1) ?? ''
const timeLabel = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`
}

function rangeFor(view: View, anchor: string): { from: string; to: string } {
  if (view === 'day') return { from: anchor, to: anchor }
  if (view === 'week') { const from = monday(anchor); return { from, to: addDays(from, 6) } }
  const first = `${anchor.slice(0, 8)}01`
  const last = addDays(`${addDays(first, 32).slice(0, 8)}01`, -1)
  return { from: monday(first), to: addDays(monday(last), 6) }
}

function entriesOn(entries: ScheduleEntry[], d: string): DayEntry[] {
  return entries
    .filter(e => e.start_date <= d && e.end_date >= d)
    .map(e => (e.end_date === e.start_date ? e : { ...e, day_of: { day: daysBetween(e.start_date, d) + 1, days: daysBetween(e.start_date, e.end_date) + 1 } }))
    // All day first, then by time
    .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.job_number.localeCompare(b.job_number))
}

function entryTitle(e: ScheduleEntry): string {
  if (e.kind === 'repair') return `${e.title}${e.who ? ` · ${e.who}` : ''}${e.visit ? ` (visit ${e.visit.number}/${e.visit.total})` : ''}`
  if (e.kind === 'appointment') return e.title
  return `${e.title}${e.who ? ` · ${e.who}` : ''}`
}

/** Move or take off an entry (trade visits and inspections) */
const ActionsContext = createContext<{ move: (e: ScheduleEntry) => void; remove: (e: ScheduleEntry) => void } | null>(null)
const canMove = (e: ScheduleEntry) => (e.kind === 'repair' && !!e.work_order_id) || e.source.type === 'inspection'

/** One thing on a day, as a card: what, when, where, and the links */
function EntryCard({ e, me }: { e: DayEntry; me: string }) {
  const actions = useContext(ActionsContext)
  const colour = KIND_COLOURS[e.kind]
  return (
    <div className="flex gap-3 rounded-lg border border-ink/10 bg-white p-3 shadow-sm">
      <div className="w-1 shrink-0 rounded-full" style={{ background: colour }} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-semibold" style={{ color: colour }}>{e.time ? timeLabel(e.time) : 'All day'}</span>
          {SHORT_LABELS[e.kind] !== entryTitle(e) && <span className="text-ink/50">{SHORT_LABELS[e.kind]}</span>}
          {e.day_of && <span className="text-ink/50">Day {e.day_of.day} of {e.day_of.days}</span>}
          {e.owner_id && e.owner_id !== me && e.owner_name && <span className="rounded-full bg-cream px-2 text-ink/70">{e.owner_name}</span>}
        </div>
        <div className="mt-0.5 truncate text-sm font-medium text-ink">{entryTitle(e)}</div>
        <div className="mt-0.5 truncate text-sm text-ink/60">
          <Link href={`/dashboard/jobs/${e.job_id}`} className="font-medium text-ink hover:underline">{e.job_number}</Link>
          {e.address ? ` · ${shortAddress(e.address)}` : ''}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-ink/60">
          {e.address && <a href={mapsLink(e.address)} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">Directions</a>}
          {actions && canMove(e) && <button type="button" onClick={() => actions.move(e)} className="underline-offset-2 hover:underline">Move</button>}
          {actions && e.kind === 'repair' && e.work_order_id && <button type="button" onClick={() => actions.remove(e)} className="underline-offset-2 hover:underline">Remove</button>}
        </div>
      </div>
    </div>
  )
}

/** A day as a list — the day view, and each day of the week on a phone */
function DayList({ date, entries, me, showHeading }: { date: string; entries: DayEntry[]; me: string; showHeading?: boolean }) {
  const today = date === perthDate()
  return (
    <section>
      {showHeading && (
        <h3 className={`mb-2 text-sm font-semibold ${today ? 'text-ink' : 'text-ink/70'}`}>
          {fmt(date, { weekday: 'long', day: 'numeric', month: 'short' })}{today ? ' · Today' : ''}
        </h3>
      )}
      {entries.length
        ? <div className="space-y-2">{entries.map(e => <EntryCard key={`${e.source.type}-${e.source.id}`} e={e} me={me} />)}</div>
        : <p className="rounded-lg border border-dashed border-ink/10 px-3 py-4 text-sm text-ink/40">Nothing on.</p>}
    </section>
  )
}

/** A compact chip inside the week grid */
function Chip({ e, onOpen }: { e: DayEntry; onOpen: () => void }) {
  const colour = KIND_COLOURS[e.kind]
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${SHORT_LABELS[e.kind]} — ${entryTitle(e)} — ${e.job_number}, ${shortAddress(e.address)}`}
      className="line-clamp-2 block w-full rounded px-1.5 py-1 text-left text-xs leading-snug text-white"
      style={{ background: colour }}
    >
      {e.time && <span className="font-semibold">{timeLabel(e.time)} </span>}
      {e.kind === 'repair' ? e.title : e.kind === 'appointment' ? e.title : SHORT_LABELS[e.kind]}
      <span className="opacity-80"> · {e.job_number} {suburb(e.address)}</span>
    </button>
  )
}

/** Monday to Sunday in columns; work over several days as bars across them */
function WeekGrid({ from, entries, onOpenDay }: { from: string; entries: ScheduleEntry[]; onOpenDay: (d: string) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i))
  const to = days[6]
  const today = perthDate()
  // Bars: each in the first lane it fits
  const spans = entries.filter(e => e.end_date > e.start_date && e.end_date >= from && e.start_date <= to)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
  const lanes: string[][] = []
  const placed = spans.map(e => {
    const start = Math.max(0, daysBetween(from, e.start_date))
    const end = Math.min(6, daysBetween(from, e.end_date))
    let lane = lanes.findIndex(l => l.slice(start, end + 1).every(x => !x))
    if (lane < 0) { lanes.push(Array(7).fill('')); lane = lanes.length - 1 }
    for (let i = start; i <= end; i++) lanes[lane][i] = e.source.id
    return { e, start, end, lane }
  })
  return (
    <div className="overflow-hidden rounded-lg border border-ink/10 bg-white shadow-sm">
      <div className="grid grid-cols-7 border-b border-ink/10 bg-cream/50">
        {days.map(d => (
          <button key={d} type="button" onClick={() => onOpenDay(d)} className={`px-2 py-2 text-left text-xs hover:bg-cream ${d === today ? 'font-semibold text-ink' : 'text-ink/60'}`}>
            {fmt(d, { weekday: 'short' })} <span className={d === today ? 'rounded-full bg-ink px-1.5 text-cream' : ''}>{fmt(d, { day: 'numeric' })}</span>
          </button>
        ))}
      </div>
      {placed.length > 0 && (
        <div className="grid grid-cols-7 gap-y-1 border-b border-ink/10 px-1 py-1">
          {placed.map(({ e, start, end, lane }) => (
            <div key={e.source.id} className="px-0.5" style={{ gridColumn: `${start + 1} / ${end + 2}`, gridRow: lane + 1 }}>
              <Chip e={e} onOpen={() => onOpenDay(days[start])} />
            </div>
          ))}
        </div>
      )}
      <div className="grid min-h-48 grid-cols-7 divide-x divide-ink/5">
        {days.map(d => (
          <div key={d} className="space-y-1 p-1">
            {entriesOn(entries, d).filter(e => !e.day_of).map(e => <Chip key={e.source.id} e={e} onOpen={() => onOpenDay(d)} />)}
          </div>
        ))}
      </div>
    </div>
  )
}

/** The month as counts per day by kind — tap a day to see it */
function MonthGrid({ anchor, from, to, entries, onOpenDay }: { anchor: string; from: string; to: string; entries: ScheduleEntry[]; onOpenDay: (d: string) => void }) {
  const days: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d)
  const month = anchor.slice(0, 7)
  const today = perthDate()
  return (
    <div className="overflow-hidden rounded-lg border border-ink/10 bg-white shadow-sm">
      <div className="grid grid-cols-7 border-b border-ink/10 bg-cream/50">
        {WEEKDAYS.map(w => <div key={w} className="px-2 py-2 text-xs text-ink/60">{w}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map(d => {
          const on = entriesOn(entries, d)
          const counts = SCHEDULE_KINDS.map(k => [k, on.filter(e => e.kind === k).length] as const).filter(([, n]) => n)
          return (
            <button
              key={d}
              type="button"
              onClick={() => onOpenDay(d)}
              className={`min-h-20 border-b border-r border-ink/5 p-1.5 text-left align-top hover:bg-cream/40 ${d.slice(0, 7) !== month ? 'bg-cream/20 text-ink/30' : ''}`}
            >
              <div className={`text-xs ${d === today ? 'inline-block rounded-full bg-ink px-1.5 font-semibold text-cream' : 'text-ink/60'}`}>{fmt(d, { day: 'numeric' })}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {counts.map(([k, n]) => (
                  <span key={k} title={`${n} ${SHORT_LABELS[k].toLowerCase()}`} className="inline-flex items-center gap-1 rounded-full px-1.5 text-[11px] text-white" style={{ background: KIND_COLOURS[k] }}>
                    {n}
                  </span>
                ))}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function ScheduleCalendar() {
  const [view, setView] = useState<View>('week')
  const [anchor, setAnchor] = useState(perthDate())
  const [kinds, setKinds] = useState<ScheduleKind[]>([])
  const [person, setPerson] = useState('everyone')
  const [tradeInput, setTradeInput] = useState('')
  const [trade, setTrade] = useState('')
  const [entries, setEntries] = useState<ScheduleEntry[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [me, setMe] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [booking, setBooking] = useState<BookingTarget | null>(null)
  const [refresh, setRefresh] = useState(0)

  // The view and filters are remembered on this device
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as { view?: View; kinds?: ScheduleKind[]; person?: string } | null
      const small = window.matchMedia('(max-width: 767px)').matches
      setView(saved?.view ?? (small ? 'day' : 'week'))
      if (saved?.kinds) setKinds(saved.kinds.filter(k => SCHEDULE_KINDS.includes(k)))
      if (saved?.person) setPerson(saved.person)
    } catch { /* no saved choices */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ view, kinds, person })) } catch { /* not kept */ }
  }, [view, kinds, person])
  useEffect(() => {
    const t = setTimeout(() => setTrade(tradeInput.trim()), 300)
    return () => clearTimeout(t)
  }, [tradeInput])

  const { from, to } = useMemo(() => rangeFor(view, anchor), [view, anchor])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const q = new URLSearchParams({ from, to, person })
    if (kinds.length) q.set('kinds', kinds.join(','))
    if (trade) q.set('trade', trade)
    try {
      const res = await fetch(`/api/schedule?${q}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Couldn\'t load the schedule')
      setEntries(body.entries)
      setPeople(body.people)
      setMe(body.me)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn\'t load the schedule')
    } finally {
      setLoading(false)
    }
  }, [from, to, person, kinds, trade])
  // Again after a booking (refresh)
  useEffect(() => { void load() }, [load, refresh])

  const step = (n: number) => setAnchor(a => view === 'day' ? addDays(a, n) : view === 'week' ? addDays(a, 7 * n) : `${addDays(`${a.slice(0, 8)}01`, n > 0 ? 32 : -1).slice(0, 8)}01`)
  const openDay = (d: string) => { setAnchor(d); setView('day') }
  const actions = useMemo(() => ({
    move: (e: ScheduleEntry) => setBooking(e.kind === 'repair'
      ? { mode: 'trade', work_order_id: e.work_order_id!, visit_number: e.visit_number, label: `the ${e.title}${e.who ? ` (${e.who})` : ''}`, job_number: e.job_number, start_date: e.start_date, end_date: e.end_date !== e.start_date ? e.end_date : null, start_time: e.time }
      : { mode: 'inspection', job_id: e.job_id, inspection_id: e.source.id, label: `the ${e.title.toLowerCase()}`, job_number: e.job_number, start_date: e.start_date, start_time: e.time }),
    remove: async (e: ScheduleEntry) => {
      if (!window.confirm(`Take the ${e.title} on ${e.job_number} off the schedule?`)) return
      const res = await fetch('/api/schedule/trade-visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ work_order_id: e.work_order_id, visit_number: e.visit_number, clear: true }) })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) { window.alert(out.error ?? 'Couldn\'t take it off'); return }
      setRefresh(r => r + 1)
    },
  }), [])
  const toggleKind = (k: ScheduleKind) => setKinds(ks => (ks.includes(k) ? ks.filter(x => x !== k) : [...ks, k]))

  const title = view === 'day'
    ? fmt(anchor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : view === 'week'
      ? `${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}`
      : fmt(anchor, { month: 'long', year: 'numeric' })
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(from, i))

  return (
    <ActionsContext.Provider value={actions}>
    <div className="p-4 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Calendar</h1>
            <p className="mt-1 text-sm text-ink/60">Inspections, trades on site and job meetings.</p>
          </div>
          <div className="inline-flex rounded-lg border border-ink/10 bg-white p-0.5 text-sm">
            {(['day', 'week', 'month'] as View[]).map(v => (
              <button key={v} type="button" onClick={() => setView(v)} className={`rounded-md px-3 py-1.5 capitalize ${view === v ? 'bg-ink text-cream' : 'text-ink/70 hover:bg-cream'}`}>{v}</button>
            ))}
          </div>
        </div>

        {/* What: tap kinds to show only those (none ticked: everything) */}
        <div className="mt-5 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setKinds([])} className={`rounded-full border px-3 py-1 text-xs ${kinds.length ? 'border-ink/10 text-ink/60' : 'border-ink bg-ink text-cream'}`}>Everything</button>
          {SCHEDULE_KINDS.map(k => {
            const on = kinds.includes(k)
            return (
              <button key={k} type="button" onClick={() => toggleKind(k)} aria-pressed={on}
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs"
                style={on ? { background: KIND_COLOURS[k], borderColor: KIND_COLOURS[k], color: '#fff' } : { borderColor: 'rgba(26,26,26,0.1)', color: 'rgba(26,26,26,0.7)' }}>
                {!on && <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOURS[k] }} />}
                {SHORT_LABELS[k]}
              </button>
            )
          })}
        </div>

        {/* Whose, and a trade */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={person} onChange={e => setPerson(e.target.value)} className="rounded-lg border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink" aria-label="Whose">
            <option value="everyone">Everyone</option>
            <option value="me">Mine</option>
            {people.filter(p => p.id !== me).map(p => <option key={p.id} value={p.id}>{p.name ?? 'Unnamed'}</option>)}
          </select>
          <input value={tradeInput} onChange={e => setTradeInput(e.target.value)} placeholder="Trade or contractor…" className="w-48 rounded-lg border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink placeholder:text-ink/40" aria-label="Trade or contractor" />
        </div>

        {/* What still needs a date, for the same person */}
        <div className="mt-4"><UnbookedPanel person={person} me={me} refresh={refresh} onBook={setBooking} /></div>
        <div className="mt-3"><DoneForYouPanel refresh={refresh} onChanged={() => setRefresh(r => r + 1)} /></div>

        {/* Where we are */}
        <div className="mt-5 flex items-center gap-2">
          <button type="button" onClick={() => step(-1)} className="rounded-lg border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink hover:bg-cream" aria-label="Previous">‹</button>
          <button type="button" onClick={() => setAnchor(perthDate())} className="rounded-lg border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink hover:bg-cream">Today</button>
          <button type="button" onClick={() => step(1)} className="rounded-lg border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink hover:bg-cream" aria-label="Next">›</button>
          <h2 className="ml-2 text-base font-medium text-ink">{title}</h2>
          {loading && <span className="text-xs text-ink/40">Loading…</span>}
        </div>

        <div className="mt-4">
          {error ? (
            <p className="rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p>
          ) : view === 'day' ? (
            <DayList date={anchor} entries={entriesOn(entries, anchor)} me={me} />
          ) : view === 'week' ? (
            <>
              <div className="hidden md:block"><WeekGrid from={from} entries={entries} onOpenDay={openDay} /></div>
              <div className="space-y-5 md:hidden">
                {weekDays.map(d => <DayList key={d} date={d} entries={entriesOn(entries, d)} me={me} showHeading />)}
              </div>
            </>
          ) : (
            <MonthGrid anchor={anchor} from={from} to={to} entries={entries} onOpenDay={openDay} />
          )}
        </div>
      </div>
    </div>
    {booking && <BookingDialog target={booking} onClose={() => setBooking(null)} onDone={() => { setBooking(null); setRefresh(r => r + 1) }} />}
    </ActionsContext.Provider>
  )
}
