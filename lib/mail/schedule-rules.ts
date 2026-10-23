// Scheduled send times — in Perth time, where the office is. Pure, safe for
// client code. Perth has no daylight saving: always UTC+8.

export const OFFICE_TIME_ZONE = 'Australia/Perth'
const PERTH_OFFSET = '+08:00'
const PERTH_OFFSET_MS = 8 * 60 * 60 * 1000

/** Earliest a scheduled email can go (the cron runs every minute) */
export const MIN_SCHEDULE_LEAD_MS = 60_000

/** "2026-10-26T08:00" (Perth wall clock) → ISO instant */
export function perthLocalToIso(local: string): string | null {
  const m = local.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?$/)
  if (!m) return null
  const d = new Date(`${m[1]}T${m[2]}${m[3] ?? ':00'}${PERTH_OFFSET}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** ISO instant → "2026-10-26T08:00" Perth wall clock (for a datetime-local input) */
export function isoToPerthLocal(iso: string): string {
  return new Date(new Date(iso).getTime() + PERTH_OFFSET_MS).toISOString().slice(0, 16)
}

/** A send time from the user or the voice connector: ISO with an offset, or Perth wall clock */
export function parseSendAt(value: string): string | null {
  const v = value.trim()
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(v)) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return perthLocalToIso(v.replace(' ', 'T'))
}

/** "Mon 26 Oct, 8:00 am" in Perth time */
export function spokenSendAt(iso: string): string {
  const d = new Date(iso)
  const day = new Intl.DateTimeFormat('en-AU', { timeZone: OFFICE_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' }).format(d)
  const time = new Intl.DateTimeFormat('en-AU', { timeZone: OFFICE_TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true }).format(d)
  return `${day.replace(/,/g, '')}, ${time.replace(/\s/g, ' ').toLowerCase()}`
}

/** Gmail's quick picks: tomorrow morning and afternoon, and Monday morning (Perth) */
export function schedulePresets(now = new Date()): { label: string; at: string }[] {
  const perthNow = new Date(now.getTime() + PERTH_OFFSET_MS)
  const day = (offset: number) => {
    const d = new Date(perthNow)
    d.setUTCDate(d.getUTCDate() + offset)
    return d.toISOString().slice(0, 10)
  }
  const at = (date: string, time: string) => perthLocalToIso(`${date}T${time}`)!
  const weekday = perthNow.getUTCDay() // 0 Sunday
  const toMonday = ((8 - weekday) % 7) || 7
  const presets = [
    { label: 'Tomorrow morning', at: at(day(1), '08:00') },
    { label: 'Tomorrow afternoon', at: at(day(1), '13:00') },
  ]
  // Monday morning, unless tomorrow already is Monday
  if (toMonday !== 1) presets.push({ label: 'Monday morning', at: at(day(toMonday), '08:00') })
  return presets
}
