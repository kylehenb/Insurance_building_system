import type { Database } from '@/lib/supabase/database.types'
import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { woIsSent } from '@/app/dashboard/jobs/[jobId]/work-orders/types'
import { tradeLabelFor, workOrderAmountFor } from '@/lib/work-orders/work-order-pdf'

// Work order tools for the voice connector. "Sent" uses woIsSent and the
// amount uses workOrderAmountFor — the same rules as the Work Orders tab and
// the PDF — so the connector can't disagree with the app.

type WorkOrder = Database['public']['Tables']['work_orders']['Row']
type Trade = Database['public']['Tables']['trades']['Row']
type ScopeItem = Database['public']['Tables']['scope_items']['Row']
export type Job = Pick<Database['public']['Tables']['jobs']['Row'], 'id' | 'job_number' | 'property_address' | 'insured_name'>

const TIME_ZONE = 'Australia/Perth'
/** Cap on the "everything unsent" list so a voice answer stays short */
const MAX_UNSENT = 40

const JOB_COLUMNS = 'id, job_number, property_address, insured_name'

export interface WorkOrderSummary {
  work_order_id: string
  job_number: string
  property_address: string | null
  trade: string
  business_name: string | null
  /** Where Send would email it: the trade's contact email */
  recipient: string | null
  amount: number | null
  sent: boolean
  last_sent: { at: string; to: string | null } | null
  status: string | null
  gary_state: string | null
  /** Things to tell the user before sending */
  warnings: string[]
}

/** "irc 1001" / "IRC-1001" → "IRC1001" */
export function normaliseJobNumber(value: string): string {
  return value.replace(/[\s-]+/g, '').toUpperCase()
}

/** ilike treats % and _ as wildcards */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, m => `\\${m}`)

export const money = (n: number) =>
  n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: n % 1 ? 2 : 0 })

export const spokenDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AU', { timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' })

async function summarise(wos: WorkOrder[], jobsById: Map<string, Job>, ctx: McpContext): Promise<WorkOrderSummary[]> {
  const { supabase, tenantId } = ctx
  const tradeIds = [...new Set(wos.map(w => w.trade_id).filter((id): id is string => !!id))]
  const quoteIds = [...new Set(wos.map(w => w.quote_id).filter((id): id is string => !!id))]

  const [tradesRes, scopeRes, commsRes] = await Promise.all([
    tradeIds.length
      ? supabase.from('trades').select('*').eq('tenant_id', tenantId).in('id', tradeIds)
      : Promise.resolve({ data: [] as Trade[], error: null }),
    quoteIds.length
      ? supabase.from('scope_items').select('*').eq('tenant_id', tenantId).in('quote_id', quoteIds)
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [] as ScopeItem[], error: null }),
    supabase.from('communications').select('work_order_id, created_at, to_email')
      .eq('tenant_id', tenantId).eq('source', 'work_order_send').in('work_order_id', wos.map(w => w.id))
      .order('created_at', { ascending: false }),
  ])
  for (const res of [tradesRes, scopeRes, commsRes]) if (res.error) throw res.error

  const tradesById = new Map((tradesRes.data ?? []).map(t => [t.id, t]))
  const lastSend = new Map<string, { at: string; to: string | null }>()
  for (const c of commsRes.data ?? []) {
    if (c.work_order_id && c.created_at && !lastSend.has(c.work_order_id)) {
      lastSend.set(c.work_order_id, { at: c.created_at, to: c.to_email })
    }
  }

  return wos.map(wo => {
    const trade = wo.trade_id ? tradesById.get(wo.trade_id) ?? null : null
    const job = jobsById.get(wo.job_id)
    const quoteItems = (scopeRes.data ?? []).filter(si => si.quote_id === wo.quote_id)
    const amount = workOrderAmountFor(wo, trade, quoteItems)
    const sent = woIsSent(wo)
    const recipient = trade?.contact_email?.trim() || null
    const last = lastSend.get(wo.id) ?? null

    const warnings: string[] = []
    if (sent) {
      warnings.push(last
        ? `Already sent on ${spokenDate(last.at)}${last.to ? ` to ${last.to}` : ''}.`
        : 'Already sent (marked as sent in the app).')
    } else {
      if (!trade) warnings.push('No trade is assigned yet.')
      else if (!recipient) warnings.push(`${trade.business_name ?? 'The trade'} has no email address — ask who to send it to.`)
      if (!amount) warnings.push('The amount is $0 — no allocation set.')
    }

    return {
      work_order_id: wo.id,
      job_number: job?.job_number ?? '',
      property_address: job?.property_address ?? null,
      trade: tradeLabelFor(wo, trade) || trade?.primary_trade || 'Unknown trade',
      business_name: trade?.business_name ?? null,
      recipient,
      amount,
      sent,
      last_sent: last,
      status: wo.status,
      gary_state: wo.gary_state?.trim() || null,
      warnings,
    }
  })
}

function describe(s: WorkOrderSummary): string {
  const who = s.business_name && s.business_name !== s.trade ? `${s.trade} (${s.business_name})` : s.trade
  const amount = s.amount ? money(s.amount) : '$0'
  const state = s.sent ? 'sent' : 'not sent'
  return `- ${who}, ${amount}, ${state}.${s.warnings.length ? ' ' + s.warnings.join(' ') : ''}`
}

/** One work order's summary (same facts and warnings as find_work_orders), or null if it isn't this tenant's. */
export async function summariseWorkOrder(workOrderId: string, ctx: McpContext): Promise<WorkOrderSummary | null> {
  const { supabase, tenantId } = ctx
  const { data: wo, error } = await supabase
    .from('work_orders').select('*').eq('tenant_id', tenantId).eq('id', workOrderId).maybeSingle()
  if (error) throw error
  if (!wo) return null
  const { data: job, error: jobErr } = await supabase
    .from('jobs').select(JOB_COLUMNS).eq('tenant_id', tenantId).eq('id', wo.job_id).maybeSingle()
  if (jobErr) throw jobErr
  const [summary] = await summarise([wo], new Map(job ? [[job.id, job]] : []), ctx)
  return summary
}

/** A job by its number (case-insensitive), with close matches when there's no exact one. */
export async function findJob(jobNumber: string, ctx: McpContext): Promise<{ job: Job | null; closeMatches: string[] }> {
  const { supabase, tenantId } = ctx
  const { data: job, error } = await supabase
    .from('jobs').select(JOB_COLUMNS).eq('tenant_id', tenantId).ilike('job_number', escapeLike(jobNumber)).maybeSingle()
  if (error) throw error
  if (job) return { job, closeMatches: [] }

  const digits = jobNumber.replace(/\D/g, '')
  if (!digits) return { job: null, closeMatches: [] }
  const { data: similar } = await supabase
    .from('jobs').select('job_number').eq('tenant_id', tenantId).ilike('job_number', `%${digits}%`).limit(5)
  return { job: null, closeMatches: (similar ?? []).map(j => j.job_number) }
}

/** Most work orders a filtered search reads before narrowing down */
const MAX_SEARCHED = 500

export interface WorkOrderFilters {
  business_name?: string
  trade?: string
  suburb?: string
  sent?: boolean
  status?: string
}

const lower = (v: string | null | undefined) => (v ?? '').toLowerCase()
/** "cabinets" also finds "Cabinetmaker" */
const stem = (v: string) => v.trim().toLowerCase().replace(/(es|s)$/, '')

function readFilters(args: Record<string, unknown>): WorkOrderFilters {
  const t = (k: string) => (typeof args[k] === 'string' && (args[k] as string).trim() ? (args[k] as string).trim() : undefined)
  return { business_name: t('business_name'), trade: t('trade'), suburb: t('suburb'), status: t('status'), sent: typeof args.sent === 'boolean' ? args.sent : undefined }
}

const hasFilters = (f: WorkOrderFilters) => Object.values(f).some(v => v !== undefined)

function filterWords(f: WorkOrderFilters): string {
  return [
    f.trade && `${f.trade}`,
    f.business_name && `by ${f.business_name}`,
    f.suburb && `in ${f.suburb}`,
    f.status && `status ${f.status}`,
    f.sent !== undefined && (f.sent ? 'sent' : 'not sent'),
  ].filter(Boolean).join(', ')
}

/** Trades whose business, entity or contact name has these words */
async function tradesNamed(name: string, ctx: McpContext): Promise<Trade[]> {
  const { supabase, tenantId } = ctx
  const pattern = `%${escapeLike(name)}%`
  const results = await Promise.all(['business_name', 'entity_name', 'primary_contact'].map(col =>
    supabase.from('trades').select('*').eq('tenant_id', tenantId).ilike(col, pattern)))
  for (const r of results) if (r.error) throw r.error
  return [...new Map(results.flatMap(r => r.data ?? []).map(t => [t.id, t])).values()]
}

/** Keeps the work orders that match trade, status and sent (business and suburb are narrowed in the query) */
function matchesFilters(wo: WorkOrder, trade: Trade | null, f: WorkOrderFilters): boolean {
  if (f.status && lower(wo.status) !== f.status.toLowerCase()) return false
  if (f.sent !== undefined && woIsSent(wo) !== f.sent) return false
  if (f.trade) {
    const want = stem(f.trade)
    const said = [tradeLabelFor(wo, trade), wo.trade_name, wo.work_type?.replace(/_/g, ' '), wo.scope_summary, trade?.primary_trade, ...(trade?.trade_specialties ?? [])]
    if (!said.some(v => lower(v).includes(want))) return false
  }
  return true
}

/** Work orders across jobs (or on one job) matching the filters, oldest first */
async function searchWorkOrders(f: WorkOrderFilters, ctx: McpContext, jobId: string | null): Promise<{ wos: WorkOrder[]; trades: Map<string, Trade>; noTrade?: boolean; noSuburb?: boolean }> {
  const { supabase, tenantId } = ctx
  let query = supabase.from('work_orders').select('*').eq('tenant_id', tenantId)
  if (jobId) query = query.eq('job_id', jobId)
  if (f.business_name) {
    const named = await tradesNamed(f.business_name, ctx)
    if (!named.length) return { wos: [], trades: new Map(), noTrade: true }
    query = query.in('trade_id', named.map(t => t.id))
  }
  if (f.suburb && !jobId) {
    const { data: jobs, error } = await supabase.from('jobs').select('id').eq('tenant_id', tenantId).ilike('property_address', `%${escapeLike(f.suburb)}%`)
    if (error) throw error
    if (!jobs?.length) return { wos: [], trades: new Map(), noSuburb: true }
    query = query.in('job_id', jobs.map(j => j.id))
  }
  const { data: candidates, error } = await query.order('created_at', { ascending: false }).limit(MAX_SEARCHED)
  if (error) throw error
  const tradeIds = [...new Set((candidates ?? []).map(w => w.trade_id).filter((id): id is string => !!id))]
  const { data: trades, error: tradesErr } = tradeIds.length
    ? await supabase.from('trades').select('*').eq('tenant_id', tenantId).in('id', tradeIds)
    : { data: [] as Trade[], error: null }
  if (tradesErr) throw tradesErr
  const byId = new Map((trades ?? []).map(t => [t.id, t]))
  const wos = (candidates ?? [])
    .filter(wo => matchesFilters(wo, wo.trade_id ? byId.get(wo.trade_id) ?? null : null, f))
    .reverse()
  return { wos, trades: byId }
}

export const findWorkOrders: McpTool = {
  name: 'find_work_orders',
  title: 'Find work orders',
  description: [
    'Lists work orders with their job, trade, business, the email they would be sent to, the amount, and whether they have already been sent.',
    'Give job_number (e.g. "IRC1001") to list every work order on that job. Or search across all jobs with any of:',
    'business_name (the trade business, e.g. "True Fix"), trade (e.g. "cabinets", "roofer", "plumbing" — also matches the scope), suburb (or street — part of the job address),',
    'sent (true or false) and status — e.g. "which job is True Fix doing cabinets on in Mundaring" is business_name "True Fix", trade "cabinets", suburb "Mundaring".',
    'With nothing given, lists work orders not sent yet, across all jobs.',
    'Each work order has warnings (no email address, $0 amount, already sent) — tell the user about them.',
    'If a job has more than one work order for the same trade, ask which one the user means.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      job_number: { type: 'string', description: 'Job number, e.g. IRC1001. Spaces and dashes are ignored.' },
      business_name: { type: 'string', description: 'Trade business (or contact) name, e.g. "True Fix".' },
      trade: { type: 'string', description: 'Kind of work, e.g. "cabinets", "roofing", "electrician".' },
      suburb: { type: 'string', description: 'Suburb or street of the job, e.g. "Mundaring".' },
      sent: { type: 'boolean', description: 'true: only sent ones; false: only ones not sent yet.' },
      status: { type: 'string', description: 'Work order status, e.g. pending, engaged, invoiced.' },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const { supabase, tenantId } = ctx
    const raw = typeof args.job_number === 'string' ? args.job_number.trim() : ''
    const filters = readFilters(args)
    const filtered = hasFilters(filters)

    if (raw) {
      const jobNumber = normaliseJobNumber(raw)
      const { job, closeMatches } = await findJob(jobNumber, ctx)
      if (!job) {
        return {
          text: closeMatches.length
            ? `No job ${jobNumber}. Did you mean ${closeMatches.join(', ')}?`
            : `No job ${jobNumber} found.`,
          data: { job_number: jobNumber, close_matches: closeMatches },
          isError: true,
        }
      }
      let wos: WorkOrder[]
      if (filtered) {
        wos = (await searchWorkOrders(filters, ctx, job.id)).wos
      } else {
        const { data, error } = await supabase
          .from('work_orders').select('*').eq('tenant_id', tenantId).eq('job_id', job.id)
          .order('created_at', { ascending: true })
        if (error) throw error
        wos = data ?? []
      }
      if (!wos.length) {
        return { text: `${job.job_number} has no work orders${filtered ? ` matching ${filterWords(filters)}` : ''}.`, data: { job_number: job.job_number, work_orders: [] } }
      }

      const summaries = await summarise(wos, new Map([[job.id, job]]), ctx)
      const unsent = summaries.filter(s => !s.sent).length
      return {
        text: [
          `${job.job_number}, ${job.property_address ?? 'no address'}: ${summaries.length} work orders${filtered ? ` matching ${filterWords(filters)}` : ''}, ${unsent} not sent.`,
          ...summaries.map(describe),
        ].join('\n'),
        data: { job_number: job.job_number, property_address: job.property_address, work_orders: summaries },
      }
    }

    let matching: WorkOrder[]
    if (filtered) {
      const found = await searchWorkOrders(filters, ctx, null)
      if (found.noTrade) return { text: `No trade business called "${filters.business_name}" — try part of the name.`, data: { filters, work_orders: [] } }
      if (found.noSuburb) return { text: `No job address has "${filters.suburb}" in it.`, data: { filters, work_orders: [] } }
      matching = found.wos
      if (!matching.length) return { text: `No work orders match ${filterWords(filters)}.`, data: { filters, work_orders: [] } }
    } else {
      // No job given: work orders still to send. The filter is loose (a stray
      // newline in gary_state still counts as not started); woIsSent decides.
      const { data: candidates, error } = await supabase
        .from('work_orders').select('*').eq('tenant_id', tenantId)
        .or('gary_state.is.null,gary_state.like.not_started*')
        .order('created_at', { ascending: true })
      if (error) throw error
      matching = (candidates ?? []).filter(wo => !woIsSent(wo))
      if (!matching.length) return { text: 'Every work order has been sent.', data: { work_orders: [] } }
    }

    const shown = matching.slice(0, MAX_UNSENT)
    const { data: jobs, error: jobsErr } = await supabase
      .from('jobs').select(JOB_COLUMNS).eq('tenant_id', tenantId).in('id', [...new Set(shown.map(w => w.job_id))])
    if (jobsErr) throw jobsErr
    const summaries = await summarise(shown, new Map((jobs ?? []).map(j => [j.id, j])), ctx)

    const byJob = new Map<string, WorkOrderSummary[]>()
    for (const s of summaries) byJob.set(s.job_number, [...(byJob.get(s.job_number) ?? []), s])
    const lines = [...byJob].flatMap(([jobNumber, list]) =>
      [`${jobNumber}, ${list[0].property_address ?? 'no address'}:`, ...list.map(describe)])

    const more = matching.length > shown.length ? ` (showing the oldest ${shown.length})` : ''
    return {
      text: [
        filtered
          ? `${matching.length} work order${matching.length === 1 ? '' : 's'} matching ${filterWords(filters)}${more}, across ${byJob.size} job${byJob.size === 1 ? '' : 's'}.`
          : `${matching.length} work orders not sent yet${more}, across ${byJob.size} jobs.`,
        ...lines,
      ].join('\n'),
      data: filtered ? { filters, total: matching.length, work_orders: summaries } : { total_unsent: matching.length, work_orders: summaries },
    }
  },
}
