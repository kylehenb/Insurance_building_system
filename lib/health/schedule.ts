import vercel from '@/vercel.json'

// How often each scheduled job should run, read from vercel.json, so the
// watcher knows when one has gone quiet (tech spec §25). Understands the
// shapes we use: '* * * * *', '*/N * * * *', '0 */N * * *', 'M H * * *'.
// Anything else is treated as daily.

const DAY = 24 * 60

export function intervalMinutes(schedule: string): number {
  const [min, hour, dom, mon, dow] = schedule.trim().split(/\s+/)
  if (dom !== '*' || mon !== '*') return 31 * DAY
  if (dow !== '*') return 7 * DAY
  if (hour === '*') {
    if (min === '*') return 1
    const every = /^\*\/(\d+)$/.exec(min)
    return every ? Number(every[1]) : 60
  }
  const everyHours = /^\*\/(\d+)$/.exec(hour)
  if (everyHours) return Number(everyHours[1]) * 60
  return DAY
}

/** How long past due a job may be before it's called overdue: two missed runs, at least 15 minutes. */
export function overdueAfterMinutes(schedule: string): number {
  const every = intervalMinutes(schedule)
  return Math.max(15, every * 2) + (every >= DAY ? 120 : 0)
}

export interface ScheduledJob {
  route: string
  schedule: string
  intervalMinutes: number
  overdueAfterMinutes: number
}

export function scheduledJobs(): ScheduledJob[] {
  return (vercel as { crons: { path: string; schedule: string }[] }).crons.map(c => ({
    route: c.path,
    schedule: c.schedule,
    intervalMinutes: intervalMinutes(c.schedule),
    overdueAfterMinutes: overdueAfterMinutes(c.schedule),
  }))
}
