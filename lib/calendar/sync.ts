import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { calendar_v3 } from 'googleapis'

// The office's calendar, linked to jobs (tech spec §23.13). Events on the
// calendars the office watches (automation_config 'watch_calendar_ids') are
// copied into calendar_events every few minutes (syncCalendars — Google's
// sync token, so only changes come back) and each new or changed one is
// linked to its job (linkEvents): the job number in it, the inspection it was
// made for, the street address, or else the AI reading it beside the open
// jobs and their notes. Personal events stay unlinked. A job's appointment
// counts as booked for its KPIs.

export const LINK_MODEL = process.env.AI_CALENDAR_MODEL || 'claude-haiku-5-5'

/** How far back a calendar is first read */
const FIRST_SYNC_DAYS = 30
/** Events linked: from this far back to this far ahead */
const LINK_BACK_DAYS = 30
const LINK_AHEAD_DAYS = 90
/** Events the AI reads per run (the rest wait for the next) */
const AI_BATCH = 15
/** Jobs the AI chooses from: made, or written about, this recently */
const ACTIVE_DAYS = 90

const DAY_MS = 86_400_000
const now = () => new Date().toISOString()

export type CalendarEventRow = {
  id: string
  tenant_id: string
  calendar_id: string
  google_event_id: string
  summary: string | null
  description: string | null
  location: string | null
  start_at: string | null
  end_at: string | null
  all_day: boolean
  status: string
  html_link: string | null
  etag: string | null
  google_created_at: string | null
  job_id: string | null
  link_source: string | null
  link_reason: string | null
  linked_etag: string | null
}

const EVENT_COLUMNS = 'id, tenant_id, calendar_id, google_event_id, summary, description, location, start_at, end_at, all_day, status, html_link, etag, google_created_at, job_id, link_source, link_reason, linked_etag'

/** The calendars a company watches: automation_config 'watch_calendar_ids', comma-separated */
export async function watchedCalendars(db: SupabaseClient, tenantId: string): Promise<string[]> {
  const { data } = await db.from('automation_config').select('value').eq('tenant_id', tenantId).eq('key', 'watch_calendar_ids').maybeSingle()
  return ((data as { value: string } | null)?.value ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

/** A Google event as a row (null: nothing to keep) */
export function eventRow(e: calendar_v3.Schema$Event): Omit<CalendarEventRow, 'id' | 'tenant_id' | 'calendar_id' | 'job_id' | 'link_source' | 'link_reason' | 'linked_etag'> | null {
  if (!e.id) return null
  const allDay = !!e.start?.date && !e.start?.dateTime
  const at = (t: calendar_v3.Schema$EventDateTime | undefined) => {
    const v = t?.dateTime ?? (t?.date ? `${t.date}T00:00:00+08:00` : null)
    return v ? new Date(v).toISOString() : null
  }
  return {
    google_event_id: e.id,
    summary: e.summary ?? null,
    description: e.description ?? null,
    location: e.location ?? null,
    start_at: at(e.start),
    end_at: at(e.end),
    all_day: allDay,
    status: e.status ?? 'confirmed',
    html_link: e.htmlLink ?? null,
    etag: e.etag ?? null,
    google_created_at: e.created ?? null,
  }
}

const isGone = (err: unknown) => (err as { code?: number; status?: number })?.code === 410 || (err as { status?: number })?.status === 410

/** One calendar's changes since the last sync (or the last month, the first time) into calendar_events */
export async function syncCalendar(db: SupabaseClient, calendar: calendar_v3.Calendar, tenantId: string, calendarId: string): Promise<number> {
  const { data: state } = await db.from('calendar_sync_state').select('sync_token').eq('tenant_id', tenantId).eq('calendar_id', calendarId).maybeSingle()
  let token = (state as { sync_token: string | null } | null)?.sync_token ?? null
  const items: calendar_v3.Schema$Event[] = []
  let nextSyncToken: string | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    items.length = 0
    try {
      let pageToken: string | undefined
      do {
        const res = await calendar.events.list({
          calendarId, singleEvents: true, showDeleted: true, maxResults: 250, pageToken,
          ...(token ? { syncToken: token } : { timeMin: new Date(Date.now() - FIRST_SYNC_DAYS * DAY_MS).toISOString() }),
        })
        items.push(...(res.data.items ?? []))
        pageToken = res.data.nextPageToken ?? undefined
        nextSyncToken = res.data.nextSyncToken ?? nextSyncToken
      } while (pageToken)
      break
    } catch (err) {
      // The token expired: read it afresh
      if (token && isGone(err)) { token = null; continue }
      throw err
    }
  }

  const rows = items.map(eventRow).filter((r): r is NonNullable<ReturnType<typeof eventRow>> => !!r)
  if (rows.length) {
    const { data: existing } = await db.from('calendar_events').select('id, google_event_id')
      .eq('tenant_id', tenantId).eq('calendar_id', calendarId).in('google_event_id', rows.map(r => r.google_event_id))
    const known = new Map(((existing as { id: string; google_event_id: string }[] | null) ?? []).map(r => [r.google_event_id, r.id]))
    for (const row of rows) {
      const id = known.get(row.google_event_id)
      if (id) await db.from('calendar_events').update({ ...row, updated_at: now() }).eq('id', id)
      else if (row.status !== 'cancelled') await db.from('calendar_events').insert({ ...row, tenant_id: tenantId, calendar_id: calendarId })
    }
  }
  const saved = { tenant_id: tenantId, calendar_id: calendarId, sync_token: nextSyncToken, synced_at: now(), sync_error: null }
  if (state) await db.from('calendar_sync_state').update(saved).eq('tenant_id', tenantId).eq('calendar_id', calendarId)
  else await db.from('calendar_sync_state').insert(saved)
  return rows.length
}

// ── Linking to jobs ──

type JobRow = { id: string; job_number: string; property_address: string | null; insured_name: string | null; insurer: string | null; current_stage: string | null; created_at: string | null; kpi_started_at: string | null; kpi_visited_at: string | null; kpi_booked_at: string | null }
const JOB_COLUMNS = 'id, job_number, property_address, insured_name, insurer, current_stage, created_at, kpi_started_at, kpi_visited_at, kpi_booked_at'

/** Job numbers written in an event: IRC1079, J76364 */
export function jobNumbersIn(text: string): string[] {
  return [...new Set((text.match(/\b[A-Z]{1,4}\d{3,6}\b/gi) ?? []).map(s => s.toUpperCase()))]
}

/** "187C Leake Street, Belmont" → "187c leake": the street number and the street's first word */
export function streetKey(text: string | null | undefined): string | null {
  const m = (text ?? '').toLowerCase().match(/(?:^|[\s,(-])(\d+[a-z]?)(?:\/\d+[a-z]?)?\s+([a-z]{3,})/)
  return m ? `${m[1]} ${m[2]}` : null
}

type Link = { job: JobRow; source: 'job_number' | 'inspection' | 'address' | 'ai'; reason: string }

/** The links that need no AI: a job number in it, the inspection it was made for, or one job at that street address */
export function plainLink(e: Pick<CalendarEventRow, 'summary' | 'description' | 'location' | 'google_event_id'>, jobs: JobRow[], inspectionJobs: Map<string, string>): Link | null {
  for (const n of jobNumbersIn(`${e.summary ?? ''} ${e.description ?? ''}`)) {
    const job = jobs.find(j => j.job_number.toUpperCase() === n)
    if (job) return { job, source: 'job_number', reason: `${n} is in the event` }
  }
  const viaInspection = inspectionJobs.get(e.google_event_id)
  const inspected = viaInspection ? jobs.find(j => j.id === viaInspection) : undefined
  if (inspected) return { job: inspected, source: 'inspection', reason: 'Made for the job\'s inspection' }
  const key = streetKey(e.location) ?? streetKey(e.summary)
  if (key) {
    const at = jobs.filter(j => streetKey(j.property_address) === key)
    if (at.length === 1) return { job: at[0], source: 'address', reason: `Same address as ${at[0].job_number}` }
  }
  return null
}

const LINK_TOOL: Anthropic.Beta.BetaTool = {
  name: 'link_events',
  description: 'Say which job each calendar event is for. Call it once, with every event.',
  input_schema: {
    type: 'object',
    properties: {
      links: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            event: { type: 'string', description: 'The event\'s key (E1, E2…).' },
            job_number: { type: 'string', description: 'The job it\'s for, from the list. Empty when it\'s not one of these jobs.' },
            reason: { type: 'string', description: 'In a few words, what matched (or why none did).' },
          },
          required: ['event', 'job_number', 'reason'],
        },
      },
    },
    required: ['links'],
  },
}

const LINK_PROMPT = `You match calendar events to jobs for Insurance Repair Co (building insurance repairs in Perth). The owner's calendar mixes job appointments (inspections, make safes, site meetings, trade visits) with personal events. For each event, give the job it's for from the list, or leave job_number empty.

Match only when the event clearly points at one job: its suburb or street, the insured's name, the insurer or claim, or a job note that mentions this appointment (e.g. "Inspection tomorrow, Saturday 31 October, 1 to 2 pm" beside a Belmont event that Saturday at 1pm). A suburb alone is not enough when two jobs are in it. Personal events (family, gym, a personal roof report not on the list) get no job. When unsure, leave it empty — a wrong link is worse than none.`

/** "Sat 31 Oct, 1:00 pm" */
const perth = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(/^(\w{3}),/, '$1') : 'no time')

/**
 * Links the company's new and changed events to jobs: the plain links
 * first, then the AI for the rest (up to AI_BATCH a run). Never throws for
 * one event — an event the AI couldn't read is tried again next run.
 */
export async function linkEvents(db: SupabaseClient, tenantId: string, opts: { client?: Pick<Anthropic, 'beta'>; at?: Date } = {}): Promise<{ linked: number; read: number }> {
  const at = opts.at ?? new Date()
  const { data } = await db.from('calendar_events').select(EVENT_COLUMNS)
    .eq('tenant_id', tenantId).neq('status', 'cancelled')
    .gte('start_at', new Date(at.getTime() - LINK_BACK_DAYS * DAY_MS).toISOString())
    .lte('start_at', new Date(at.getTime() + LINK_AHEAD_DAYS * DAY_MS).toISOString())
  const todo = ((data as CalendarEventRow[] | null) ?? []).filter(e => e.link_source !== 'manual' && (!e.linked_etag || e.linked_etag !== e.etag))
  if (!todo.length) return { linked: 0, read: 0 }

  const { data: jobData } = await db.from('jobs').select(JOB_COLUMNS).eq('tenant_id', tenantId)
  const jobs = (jobData as JobRow[] | null) ?? []
  const { data: inspections } = await db.from('inspections').select('job_id, calendar_event_id').eq('tenant_id', tenantId).not('calendar_event_id', 'is', null)
  const inspectionJobs = new Map(((inspections as { job_id: string; calendar_event_id: string }[] | null) ?? []).map(i => [i.calendar_event_id, i.job_id]))

  let linked = 0
  const unmatched: CalendarEventRow[] = []
  for (const e of todo) {
    const link = plainLink(e, jobs, inspectionJobs)
    if (link) {
      await saveLink(db, e, link)
      linked++
    } else {
      unmatched.push(e)
    }
  }

  const batch = unmatched.slice(0, AI_BATCH)
  if (batch.length && (opts.client || process.env.ANTHROPIC_API_KEY)) {
    try {
      const links = await aiLinks(db, tenantId, batch, jobs, at, opts.client)
      for (const [i, e] of batch.entries()) {
        const l = links.get(`E${i + 1}`)
        const job = l?.job_number ? jobs.find(j => j.job_number.toUpperCase() === l.job_number.toUpperCase()) : undefined
        if (job) {
          await saveLink(db, e, { job, source: 'ai', reason: l!.reason })
          linked++
        } else {
          await db.from('calendar_events').update({ job_id: null, link_source: 'none', link_reason: l?.reason?.slice(0, 300) || 'Not one of the jobs', linked_etag: e.etag, updated_at: now() }).eq('id', e.id)
        }
      }
    } catch (err) {
      console.error('[calendar] linking with the AI failed:', err)
    }
  }
  return { linked, read: batch.length }
}

async function saveLink(db: SupabaseClient, e: CalendarEventRow, link: Link): Promise<void> {
  await db.from('calendar_events').update({ job_id: link.job.id, link_source: link.source, link_reason: link.reason.slice(0, 300), linked_etag: e.etag, updated_at: now() }).eq('id', e.id)
  await markBooked(db, e, link.job)
}

/**
 * A job's appointment booked after its order came in, for before (or the day
 * of) the visit, is its KPI booking — not a site meeting months later.
 */
async function markBooked(db: SupabaseClient, e: CalendarEventRow, job: JobRow): Promise<void> {
  if (job.kpi_booked_at || !job.kpi_started_at || !e.start_at) return
  const booked = e.google_created_at ?? now()
  if (booked < job.kpi_started_at) return
  if (job.kpi_visited_at && new Date(e.start_at).getTime() > new Date(job.kpi_visited_at).getTime() + DAY_MS) return
  const rpc = (db as unknown as { rpc?: (fn: string, args: Record<string, unknown>) => Promise<unknown> }).rpc
  if (rpc) await rpc.call(db, 'jobs_kpi_mark', { p_job: job.id, p_milestone: 'booked', p_at: booked })
}

/** The AI's links for events no plain rule matched: event key → job number and why */
async function aiLinks(db: SupabaseClient, tenantId: string, events: CalendarEventRow[], jobs: JobRow[], at: Date, client?: Pick<Anthropic, 'beta'>): Promise<Map<string, { job_number: string; reason: string }>> {
  const since = new Date(at.getTime() - ACTIVE_DAYS * DAY_MS).toISOString()
  const { data: notes } = await db.from('communications').select('job_id, content, created_at')
    .eq('tenant_id', tenantId).eq('type', 'note').gte('created_at', since).order('created_at', { ascending: false }).limit(300)
  const notesByJob = new Map<string, string[]>()
  for (const n of (notes as { job_id: string | null; content: string | null; created_at: string }[] | null) ?? []) {
    if (!n.job_id || !n.content) continue
    const list = notesByJob.get(n.job_id) ?? []
    if (list.length < 3) list.push(`${perth(n.created_at)}: ${n.content.slice(0, 200)}`)
    notesByJob.set(n.job_id, list)
  }
  const active = jobs.filter(j => (j.created_at && j.created_at >= since) || notesByJob.has(j.id))
  if (!active.length) return new Map()
  const jobList = active.map(j => [
    `${j.job_number}: ${j.property_address ?? 'no address'}${j.insured_name ? `, ${j.insured_name}` : ''}${j.insurer ? `, ${j.insurer}` : ''}${j.current_stage ? ` (${j.current_stage})` : ''}`,
    ...(notesByJob.get(j.id) ?? []).map(n => `   note ${n}`),
  ].join('\n')).join('\n')
  const eventList = events.map((e, i) => `E${i + 1}: ${perth(e.start_at)}${e.all_day ? ' (all day)' : ''} — "${e.summary ?? ''}"${e.location ? ` at ${e.location}` : ''}${e.description ? ` — ${e.description.slice(0, 300)}` : ''}`).join('\n')

  const anthropic = client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const response = await anthropic.beta.messages.create({
    model: LINK_MODEL,
    max_tokens: 4000,
    system: LINK_PROMPT,
    tools: [LINK_TOOL],
    tool_choice: { type: 'tool', name: LINK_TOOL.name },
    messages: [{ role: 'user', content: `THE EVENTS\n${eventList}\n\nTHE JOBS (made or written about in the last ${ACTIVE_DAYS} days, with their latest notes)\n${jobList}` }],
  } as Anthropic.Beta.MessageCreateParamsNonStreaming)
  const call = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === LINK_TOOL.name)
  const out = new Map<string, { job_number: string; reason: string }>()
  for (const l of ((call?.input as { links?: unknown[] } | undefined)?.links ?? []) as { event?: string; job_number?: string; reason?: string }[]) {
    if (l?.event) out.set(l.event, { job_number: (l.job_number ?? '').trim(), reason: (l.reason ?? '').trim() })
  }
  return out
}

/** Every company's watched calendars: synced, then linked (the calendar cron) */
export async function syncCalendars(db: SupabaseClient, calendar: () => calendar_v3.Calendar): Promise<{ events: number; linked: number; errors: string[] }> {
  const { data } = await db.from('automation_config').select('tenant_id, value').eq('key', 'watch_calendar_ids')
  const result = { events: 0, linked: 0, errors: [] as string[] }
  for (const row of (data as { tenant_id: string; value: string }[] | null) ?? []) {
    for (const calendarId of row.value.split(',').map(s => s.trim()).filter(Boolean)) {
      try {
        result.events += await syncCalendar(db, calendar(), row.tenant_id, calendarId)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[calendar] sync of ${calendarId} failed:`, err)
        result.errors.push(`${calendarId}: ${message}`)
        // Kept even when the very first read fails, so it can be seen
        const error = { sync_error: message.slice(0, 500), synced_at: now() }
        const { data: had } = await db.from('calendar_sync_state').update(error).eq('tenant_id', row.tenant_id).eq('calendar_id', calendarId).select('calendar_id')
        if (!(had as unknown[] | null)?.length) await db.from('calendar_sync_state').insert({ tenant_id: row.tenant_id, calendar_id: calendarId, ...error })
      }
    }
    result.linked += (await linkEvents(db, row.tenant_id)).linked
  }
  return result
}

/** A job's appointments, soonest first: from a day ago to a month ahead, or all recent ones */
export async function jobAppointments(db: SupabaseClient, tenantId: string, jobId: string, { from, to }: { from: Date; to: Date }): Promise<CalendarEventRow[]> {
  const { data } = await db.from('calendar_events').select(EVENT_COLUMNS)
    .eq('tenant_id', tenantId).eq('job_id', jobId).neq('status', 'cancelled')
    .gte('start_at', from.toISOString()).lte('start_at', to.toISOString())
    .order('start_at', { ascending: true }).limit(20)
  return (data as CalendarEventRow[] | null) ?? []
}

export { perth as spokenEventTime }
