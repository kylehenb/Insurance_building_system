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
type Job = Pick<Database['public']['Tables']['jobs']['Row'], 'id' | 'job_number' | 'property_address' | 'insured_name'>

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

const spokenDate = (iso: string) =>
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

async function findJob(jobNumber: string, ctx: McpContext): Promise<{ job: Job | null; closeMatches: string[] }> {
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

export const findWorkOrders: McpTool = {
  name: 'find_work_orders',
  title: 'Find work orders',
  description: [
    'Lists work orders with their trade, the email they would be sent to, the amount, and whether they have already been sent.',
    'Give job_number (e.g. "IRC1001") to list every work order on that job;',
    'leave it out to list work orders that have not been sent yet, across all jobs.',
    'Each work order has warnings (no email address, $0 amount, already sent) — tell the user about them.',
    'If a job has more than one work order for the same trade, ask which one the user means.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      job_number: { type: 'string', description: 'Job number, e.g. IRC1001. Spaces and dashes are ignored.' },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const { supabase, tenantId } = ctx
    const raw = typeof args.job_number === 'string' ? args.job_number.trim() : ''

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
      const { data: wos, error } = await supabase
        .from('work_orders').select('*').eq('tenant_id', tenantId).eq('job_id', job.id)
        .order('created_at', { ascending: true })
      if (error) throw error
      if (!wos?.length) {
        return { text: `${job.job_number} has no work orders.`, data: { job_number: job.job_number, work_orders: [] } }
      }

      const summaries = await summarise(wos, new Map([[job.id, job]]), ctx)
      const unsent = summaries.filter(s => !s.sent).length
      return {
        text: [
          `${job.job_number}, ${job.property_address ?? 'no address'}: ${summaries.length} work orders, ${unsent} not sent.`,
          ...summaries.map(describe),
        ].join('\n'),
        data: { job_number: job.job_number, property_address: job.property_address, work_orders: summaries },
      }
    }

    // No job given: work orders still to send. The filter is loose (a stray
    // newline in gary_state still counts as not started); woIsSent decides.
    const { data: candidates, error } = await supabase
      .from('work_orders').select('*').eq('tenant_id', tenantId)
      .or('gary_state.is.null,gary_state.like.not_started*')
      .order('created_at', { ascending: true })
    if (error) throw error
    const unsent = (candidates ?? []).filter(wo => !woIsSent(wo))
    if (!unsent.length) return { text: 'Every work order has been sent.', data: { work_orders: [] } }

    const shown = unsent.slice(0, MAX_UNSENT)
    const { data: jobs, error: jobsErr } = await supabase
      .from('jobs').select(JOB_COLUMNS).eq('tenant_id', tenantId).in('id', [...new Set(shown.map(w => w.job_id))])
    if (jobsErr) throw jobsErr
    const summaries = await summarise(shown, new Map((jobs ?? []).map(j => [j.id, j])), ctx)

    const byJob = new Map<string, WorkOrderSummary[]>()
    for (const s of summaries) byJob.set(s.job_number, [...(byJob.get(s.job_number) ?? []), s])
    const lines = [...byJob].flatMap(([jobNumber, list]) =>
      [`${jobNumber}, ${list[0].property_address ?? 'no address'}:`, ...list.map(describe)])

    return {
      text: [
        `${unsent.length} work orders not sent yet${unsent.length > shown.length ? ` (showing the oldest ${shown.length})` : ''}, across ${byJob.size} jobs.`,
        ...lines,
      ].join('\n'),
      data: { total_unsent: unsent.length, work_orders: summaries },
    }
  },
}
