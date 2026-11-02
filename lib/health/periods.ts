// Days and periods for the health check (tech spec §25.3). Figures are kept
// per Perth calendar day (UTC+8, no daylight saving), and any week (Monday to
// Sunday), month, quarter or year is a run of those days.

export type PeriodKind = 'week' | 'month' | 'quarter' | 'year'
export const PERIOD_KINDS: PeriodKind[] = ['week', 'month', 'quarter', 'year']

const PERTH_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** The Perth day ('YYYY-MM-DD') an instant falls on. */
export function perthDay(at: Date | string): string {
  const ms = typeof at === 'string' ? Date.parse(at) : at.getTime()
  return new Date(ms + PERTH_OFFSET_MS).toISOString().slice(0, 10)
}

/** The instant a Perth day starts, as an ISO string (for timestamp queries). */
export function dayStartIso(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - PERTH_OFFSET_MS).toISOString()
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
}

/** Every day from `from` up to, not including, `to`. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d < to; d = addDays(d, 1)) out.push(d)
  return out
}

export interface Period {
  kind: PeriodKind
  /** 0 = the current period, 1 = the one before… */
  offset: number
  /** First day */
  from: string
  /** Day after the last */
  to: string
  label: string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function ymd(y: number, m: number, d = 1): string {
  return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10)
}

function shortDay(day: string): string {
  const [, m, d] = day.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
}

export function periodFor(kind: PeriodKind, offset: number, now: Date = new Date()): Period {
  const today = perthDay(now)
  const [y, m] = today.split('-').map(Number)
  if (kind === 'week') {
    const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7 // Monday = 0
    const from = addDays(today, -weekday - 7 * offset)
    const to = addDays(from, 7)
    return { kind, offset, from, to, label: offset === 0 ? 'This week' : offset === 1 ? 'Last week' : `Week of ${shortDay(from)}` }
  }
  if (kind === 'month') {
    const from = ymd(y, m - 1 - offset)
    const to = ymd(y, m - offset)
    const [fy, fm] = from.split('-').map(Number)
    return { kind, offset, from, to, label: offset === 0 ? 'This month' : `${MONTHS[fm - 1]} ${fy}` }
  }
  if (kind === 'quarter') {
    const q = Math.floor((m - 1) / 3)
    const from = ymd(y, (q - offset) * 3)
    const to = ymd(y, (q - offset + 1) * 3)
    const [fy, fm] = from.split('-').map(Number)
    return { kind, offset, from, to, label: offset === 0 ? 'This quarter' : `Q${Math.floor((fm - 1) / 3) + 1} ${fy}` }
  }
  const from = ymd(y - offset, 0)
  const to = ymd(y - offset + 1, 0)
  return { kind, offset, from, to, label: offset === 0 ? 'This year' : String(y - offset) }
}
