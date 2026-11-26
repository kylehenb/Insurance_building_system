import type { SupabaseClient } from '@supabase/supabase-js'
import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { isToolResult, jobFromArgs } from '@/lib/mcp/tools/excess'
import { VisitScheduleError, scheduleTradeVisit } from '@/lib/work-orders/visits'
import { KIND_LABELS, SCHEDULE_KINDS, addDays, loadSchedule, perthDate, scheduleByDay, type ScheduleEntry, type ScheduleKind } from '@/lib/schedule/schedule'

// The schedule by voice and chat (tech spec §23.18): "painter's going to
// IRC1079 Tuesday to Thursday" books the trade's days, and "what's on
// Thursday?" reads back everything happening — inspections, trades on site,
// site meetings — narrowed to a kind, a trade or a person.

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const db = (ctx: McpContext) => ctx.supabase as unknown as SupabaseClient
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** "Tue 3 Dec" */
export function spokenDay(date: string): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${date}T00:00:00Z`)).replace(/,/g, '')
}
const spokenDays = (start: string, end: string | null) => (end && end !== start ? `${spokenDay(start)} to ${spokenDay(end)} (${Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1} days)` : spokenDay(start))
/** "8:00 am" */
const spokenTime = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}
/** "187C Leake Street, Belmont" — without the state and postcode */
const shortAddress = (a: string | null) => (a ?? '').replace(/,?\s*(WA|NSW|VIC|QLD|SA|TAS|NT|ACT)\s*\d{4}\s*$/i, '').trim()

type WoRow = { id: string; trade_name: string | null; trade_id: string | null; status: string | null }

export const bookTradeVisit: McpTool = {
  name: 'book_trade_visit',
  title: 'Book trade visit',
  description: [
    'Records the firm day(s) a trade is on site for a job — "the painter\'s going to IRC1079 on Tuesday", "carpenter at the Belmont job Monday to Wednesday", "move the plumber to Friday", "the electrician cancelled". It\'s what puts trades on the schedule (get_schedule).',
    'trade is the trade or contractor as said ("painter", "Bob\'s Painting"); it picks that work order on the job. start_date and end_date are Perth dates "2026-12-03"; end_date only for work over several days. Only firm days: if the trade said "sometime next week", don\'t book it — say a firm day is needed.',
    'A work order with several visits (an electrician\'s disconnect and reconnect) books the next one not yet booked; give visit_number to move a particular one. clear takes the date off.',
    'IRC doesn\'t tell the trade or homeowner — this records what was agreed. Read back the trade, job, day(s) and get a yes first.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      job_number: { type: 'string', description: 'The job, e.g. IRC1079.' },
      trade: { type: 'string', description: 'The trade or contractor, e.g. "painter" or "Bob\'s Painting".' },
      work_order_id: { type: 'string', description: 'Instead of trade, when known (from find_work_orders).' },
      start_date: { type: 'string', description: 'First day on site, Perth date "2026-12-03".' },
      end_date: { type: 'string', description: 'Last day, for work over several days.' },
      visit_number: { type: 'number', description: 'Which visit, when the work order has several.' },
      note: { type: 'string', description: 'Anything agreed, e.g. "7am start, key in lockbox".' },
      clear: { type: 'boolean', description: 'Take the booking off (the trade cancelled, or it isn\'t firm any more).' },
    },
    required: ['job_number'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  permission: 'jobs.edit',

  async run(args, ctx): Promise<McpToolResult> {
    const clear = args.clear === true
    const start = str(args.start_date)
    const end = str(args.end_date)
    if (!clear && !DATE.test(start)) return { text: 'Which day is the trade on site? A firm date like "2026-12-03".', isError: true }
    const found = await jobFromArgs(args, ctx)
    if (isToolResult(found)) return found

    const { data } = await db(ctx).from('work_orders').select('id, trade_name, trade_id, status').eq('tenant_id', ctx.tenantId).eq('job_id', found.id)
    const workOrders = (data as WoRow[] | null) ?? []
    if (!workOrders.length) return { text: `${found.job_number} has no work orders yet — make one for the trade first.`, isError: true }
    const tradeIds = [...new Set(workOrders.map(w => w.trade_id).filter((v): v is string => !!v))]
    const { data: tradeRows } = tradeIds.length ? await db(ctx).from('trades').select('id, business_name, primary_contact').eq('tenant_id', ctx.tenantId).in('id', tradeIds) : { data: [] }
    const trades = new Map(((tradeRows as { id: string; business_name: string | null; primary_contact: string | null }[] | null) ?? []).map(t => [t.id, t]))
    const label = (w: WoRow) => {
      const business = w.trade_id ? trades.get(w.trade_id)?.business_name : null
      return `${w.trade_name ?? 'Trade'}${business ? ` (${business})` : ''}`
    }

    let wo: WoRow | undefined
    const id = str(args.work_order_id)
    const said = str(args.trade).toLowerCase()
    if (id) wo = workOrders.find(w => w.id === id)
    else if (said) {
      const matches = workOrders.filter(w => {
        const t = w.trade_id ? trades.get(w.trade_id) : undefined
        return [w.trade_name, t?.business_name, t?.primary_contact].some(v => v && (v.toLowerCase().includes(said) || said.includes(v.toLowerCase())))
      })
      if (matches.length > 1) return { text: `${found.job_number} has ${matches.length} work orders matching "${str(args.trade)}": ${matches.map(label).join(', ')}. Which one?`, data: { work_orders: matches.map(w => ({ work_order_id: w.id, trade: label(w) })) }, isError: true }
      wo = matches[0]
    } else if (workOrders.length === 1) wo = workOrders[0]
    if (!wo) {
      return { text: `Which trade on ${found.job_number}? It has: ${workOrders.map(label).join(', ')}.`, data: { work_orders: workOrders.map(w => ({ work_order_id: w.id, trade: label(w) })) }, isError: true }
    }

    try {
      const v = await scheduleTradeVisit(db(ctx), {
        tenantId: ctx.tenantId, workOrderId: wo.id, startDate: start || undefined, endDate: end || undefined,
        visitNumber: Number(args.visit_number) || undefined, note: str(args.note) || undefined, clear,
      })
      const which = v.total_visits > 1 ? ` visit ${v.visit_number} of ${v.total_visits}` : ''
      const was = v.previous ? ` (was ${spokenDays(v.previous.start_date, v.previous.end_date)})` : ''
      const text = clear
        ? `Took the ${label(wo)}${which} off the schedule for ${found.job_number}${was}.`
        : `${v.previous ? 'Moved' : 'Booked'} the ${label(wo)}${which} on ${found.job_number} for ${spokenDays(v.start_date!, v.end_date)}${was}.`
      return { text, data: { job_number: found.job_number, trade: label(wo), ...v } }
    } catch (err) {
      if (err instanceof VisitScheduleError) return { text: err.message, isError: true }
      throw err
    }
  },
}

function entryLine(e: ScheduleEntry & { day_of?: { day: number; days: number } }, askerId: string): string {
  const where = `${e.job_number}, ${shortAddress(e.address) || 'no address'}`
  const time = e.time ? `${spokenTime(e.time)} ` : ''
  const what = e.kind === 'repair'
    ? `${e.title}${e.who ? ` (${e.who})` : ''}${e.visit ? `, visit ${e.visit.number} of ${e.visit.total}` : ''}`
    : e.kind === 'appointment' ? e.title : `${e.title}${e.who ? ` with ${e.who}` : ''}`
  const span = e.day_of ? ` — day ${e.day_of.day} of ${e.day_of.days}` : ''
  // Someone else's is marked with their name; the asker's own aren't
  const owner = e.owner_id && e.owner_id !== askerId && e.owner_name ? ` [${e.owner_name}]` : ''
  return e.kind === 'appointment' ? `- ${time}${what}${span} — ${where}${owner}` : `- ${time}${what} — ${where}${span}${owner}`
}

export const getSchedule: McpTool = {
  name: 'get_schedule',
  title: 'Get schedule',
  description: [
    'What\'s happening on the jobs, day by day — "what\'s on Thursday?", "what inspections have I got next week?", "which trades are on site this week?", "when\'s the painter at IRC1079?". Inspections (and make safes, roof reports, leak detections), trades\' days on site (book_trade_visit), and site meetings and other job appointments from the calendar.',
    'from and to are Perth dates "2026-12-03" (to defaults to from; up to two months). kinds narrows what: inspection, make_safe, roof, leak_detection, specialist, repair (trades on site), appointment. person narrows whose: "me" (the asker\'s inspections and the jobs they look after, plus any job nobody\'s been given), a colleague\'s name, or leave it out for everyone. trade narrows to a trade or contractor; job_number to one job.',
    'Read it back by day, briefly.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'First day, Perth date "2026-12-03". Default today.' },
      to: { type: 'string', description: 'Last day. Default the same as from.' },
      kinds: { type: 'array', items: { type: 'string', enum: [...SCHEDULE_KINDS] }, description: 'Only these kinds.' },
      person: { type: 'string', description: '"me", or a colleague\'s name. Leave out for everyone.' },
      trade: { type: 'string', description: 'Only this trade or contractor, e.g. "painter".' },
      job_number: { type: 'string', description: 'Only this job.' },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const from = str(args.from) || perthDate()
    const to = str(args.to) || from
    if (!DATE.test(from) || !DATE.test(to)) return { text: 'Give the days as dates like "2026-12-03".', isError: true }
    if (to < from) return { text: 'The last day is before the first.', isError: true }
    const last = to > addDays(from, 62) ? addDays(from, 62) : to
    const kinds = Array.isArray(args.kinds) ? (args.kinds as unknown[]).filter((k): k is ScheduleKind => SCHEDULE_KINDS.includes(k as ScheduleKind)) : undefined

    let personId: string | undefined
    let includeUnassigned = false
    let personName = ''
    const person = str(args.person)
    if (person && !/^(everyone|everybody|all|anyone)$/i.test(person)) {
      if (/^(me|mine|my|myself|i)$/i.test(person)) {
        personId = ctx.userId
        includeUnassigned = true
        personName = 'yours'
      } else {
        const { data } = await db(ctx).from('users').select('id, name').eq('tenant_id', ctx.tenantId)
        const users = ((data as { id: string; name: string | null }[] | null) ?? []).filter(u => u.name?.toLowerCase().includes(person.toLowerCase()))
        if (users.length !== 1) return { text: users.length ? `Which ${person}: ${users.map(u => u.name).join(', ')}?` : `No one called ${person} in IRC.`, isError: true }
        personId = users[0].id
        personName = `${users[0].name}'s`
        if (personId === ctx.userId) includeUnassigned = true
      }
    }

    let jobId: string | undefined
    if (str(args.job_number)) {
      const found = await jobFromArgs(args, ctx)
      if (isToolResult(found)) return found
      jobId = found.id
    }

    const entries = await loadSchedule(db(ctx), ctx.tenantId, { from, to: last, kinds, personId, includeUnassigned, trade: str(args.trade) || undefined, jobId })
    const narrowed = [
      kinds?.length ? kinds.map(k => KIND_LABELS[k].toLowerCase()).join(', ') : '',
      str(args.trade) ? str(args.trade) : '',
      personName,
    ].filter(Boolean).join(', ')
    const range = from === last ? spokenDay(from) : `${spokenDay(from)} to ${spokenDay(last)}`
    if (!entries.length) return { text: `Nothing on the schedule for ${range}${narrowed ? ` (${narrowed})` : ''}.`, data: { from, to: last, entries: [] } }

    const days = scheduleByDay(entries, from, last).filter(d => d.entries.length)
    const header = `${range}${narrowed ? ` (${narrowed})` : ''}:`
    const text = from === last
      ? [header, ...days[0].entries.map(e => entryLine(e, ctx.userId))].join('\n')
      : [header, ...days.map(d => [`${spokenDay(d.date)}:`, ...d.entries.map(e => entryLine(e, ctx.userId))].join('\n'))].join('\n')
    return { text, data: { from, to: last, entries } }
  },
}
