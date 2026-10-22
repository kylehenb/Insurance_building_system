import type { Database } from '@/lib/supabase/database.types'
import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { money, spokenDate } from '@/lib/mcp/tools/work-orders'
import { getGmailClient } from '@/lib/gmail/client'
import { extractMessageParts, getFullMessage } from '@/lib/gmail/messages'
import { parseInsurerOrder } from '@/lib/email/order-parser'
import { writeInsurerOrder } from '@/lib/email/order-writer'
import { LodgeError, lodgeInsurerOrder } from '@/lib/insurer-orders/lodge'

// Insurer orders by voice: the orders waiting to be lodged, finding an order
// email the auto job lodger missed and turning it into an order, and lodging
// an order as a job. Turning an email into an order runs the auto lodger's own
// parser and writer (lib/email/order-parser.ts, order-writer.ts); lodging is
// the Lodge button's lodgeInsurerOrder.

type Order = Database['public']['Tables']['insurer_orders']['Row']

const OWN_DOMAIN = 'insurancerepairco.com.au'
const EMAIL_SEARCH_DAYS = 90
const MAX_EMAILS = 10
const MAX_ORDERS = 20

const ORDER_COLUMNS = 'id, created_at, status, parse_status, entry_method, claim_number, insurer, wo_type, property_address, insured_name, insured_phone, date_of_loss, loss_type, excess_building, job_id, raw_email_subject'
type OrderSummaryRow = Pick<Order, 'id' | 'created_at' | 'status' | 'parse_status' | 'entry_method' | 'claim_number' | 'insurer' | 'wo_type' | 'property_address' | 'insured_name' | 'insured_phone' | 'date_of_loss' | 'loss_type' | 'excess_building' | 'job_id' | 'raw_email_subject'>

const WO_TYPE_LABELS: Record<string, string> = {
  BAR: 'assessment (BAR)', make_safe: 'make safe', roof_report: 'roof report', specialist: 'specialist report', quote_only: 'quote only',
}

/** Missing details that stop or weaken a lodge */
function orderWarnings(o: OrderSummaryRow): string[] {
  const warnings: string[] = []
  if (!o.claim_number) warnings.push('No claim number — it can\'t be lodged until one is added in the app.')
  if (!o.property_address) warnings.push('No property address.')
  if (!o.insured_name) warnings.push('No insured name.')
  if (o.parse_status === 'needs_review') warnings.push('Marked "needs review" — check the details.')
  return warnings
}

function describeOrder(o: OrderSummaryRow): string {
  const parts = [
    o.claim_number ? `claim ${o.claim_number}` : 'no claim number',
    o.insurer,
    o.wo_type ? WO_TYPE_LABELS[o.wo_type] ?? o.wo_type : null,
    o.insured_name,
    o.property_address,
    o.excess_building ? `excess ${money(Number(o.excess_building))}` : null,
  ].filter(Boolean)
  const when = o.created_at ? ` (received ${spokenDate(o.created_at)})` : ''
  const warnings = orderWarnings(o)
  return `${parts.join(', ')}${when}.${warnings.length ? ' ' + warnings.join(' ') : ''}`
}

const orderData = (o: OrderSummaryRow) => ({ order_id: o.id, ...o, warnings: orderWarnings(o) })

export const listInsurerOrders: McpTool = {
  name: 'list_insurer_orders',
  title: 'List insurer orders',
  description: [
    'Lists insurer orders waiting to be lodged as jobs (newest first), with claim number, insurer, work type, insured, address and anything missing.',
    'If an order the user expects isn\'t here, it may not have been picked up from the email — use find_order_emails.',
  ].join(' '),
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(_args, ctx): Promise<McpToolResult> {
    const { data, error } = await ctx.supabase
      .from('insurer_orders').select(ORDER_COLUMNS)
      .eq('tenant_id', ctx.tenantId).eq('status', 'pending').is('job_id', null)
      .order('created_at', { ascending: false }).limit(MAX_ORDERS)
    if (error) throw error
    const orders = (data ?? []) as OrderSummaryRow[]
    if (!orders.length) return { text: 'No insurer orders are waiting to be lodged.', data: { orders: [] } }
    return {
      text: [`${orders.length} order${orders.length === 1 ? '' : 's'} waiting to be lodged:`, ...orders.map(o => `- ${describeOrder(o)}`)].join('\n'),
      data: { orders: orders.map(orderData) },
    }
  },
}

interface FoundEmail {
  message_id: string
  thread_id: string | null
  from: string
  subject: string
  received: string | null
  in_system: string
  order_id: string | null
}

const header = (headers: { name?: string | null; value?: string | null }[] | undefined, name: string) =>
  headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''

/** What the app already has for this email: an order, a job email, or nothing. */
async function emailStatus(ctx: McpContext, messageId: string, threadId: string | null): Promise<{ text: string; orderId: string | null }> {
  const { supabase, tenantId } = ctx
  const { data: orders } = await supabase
    .from('insurer_orders').select('id, status, job_id, claim_number')
    .eq('tenant_id', tenantId).like('raw_email_link', `%${messageId}%`).limit(1)
  const order = orders?.[0]
  if (order) return { text: `already an order (${order.status}${order.claim_number ? `, claim ${order.claim_number}` : ''})`, orderId: order.id }
  if (threadId) {
    const { data: comms } = await supabase
      .from('communications').select('job_id, insurer_order_id' as never)
      .eq('tenant_id', tenantId).eq('thread_id' as never, threadId as never).limit(5)
    const rows = (comms ?? []) as unknown as { job_id: string | null; insurer_order_id: string | null }[]
    const withOrder = rows.find(r => r.insurer_order_id)
    if (withOrder) return { text: 'its conversation already has an order', orderId: withOrder.insurer_order_id }
    if (rows.some(r => r.job_id)) return { text: 'its conversation is already on a job', orderId: null }
  }
  return { text: 'not in the system', orderId: null }
}

export const findOrderEmails: McpTool = {
  name: 'find_order_emails',
  title: 'Find order emails',
  description: [
    `Searches the office inbox (last ${EMAIL_SEARCH_DAYS} days, not our own emails) for insurer order emails — by claim number, insured name, address or any Gmail search —`,
    'and says whether each one is already an order or on a job. Use it when the user says an order email wasn\'t picked up, then create_order_from_email.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'e.g. a claim number "CHCCLM010002035", "Laundy", "Randell Crescent", or Gmail syntax like from:castle' } },
    required: ['query'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: true },

  async run(args, ctx): Promise<McpToolResult> {
    const query = typeof args.query === 'string' ? args.query.trim() : ''
    if (!query) return { text: 'What should I search for — a claim number, name or address?', isError: true }
    const gmail = getGmailClient()
    const list = await gmail.users.messages.list({
      userId: 'me', q: `${query} -from:${OWN_DOMAIN} newer_than:${EMAIL_SEARCH_DAYS}d`, maxResults: MAX_EMAILS,
    })
    const ids = (list.data.messages ?? []).map(m => m.id).filter((id): id is string => !!id)
    if (!ids.length) return { text: `No emails found for "${query}" in the last ${EMAIL_SEARCH_DAYS} days.`, data: { emails: [] } }

    const emails: FoundEmail[] = []
    for (const id of ids) {
      const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] })
      const headers = msg.data.payload?.headers ?? undefined
      const status = await emailStatus(ctx, id, msg.data.threadId ?? null)
      const internal = msg.data.internalDate ? new Date(Number(msg.data.internalDate)).toISOString() : null
      emails.push({
        message_id: id,
        thread_id: msg.data.threadId ?? null,
        from: header(headers, 'From'),
        subject: header(headers, 'Subject'),
        received: internal,
        in_system: status.text,
        order_id: status.orderId,
      })
    }
    return {
      text: emails.map(e => `- ${e.received ? spokenDate(e.received) : ''} from ${e.from}: "${e.subject}" — ${e.in_system}.`).join('\n'),
      data: { emails },
    }
  },
}

export const createOrderFromEmail: McpTool = {
  name: 'create_order_from_email',
  title: 'Create order from email',
  description: [
    'Turns an insurer\'s order email into an insurer order, using the auto job lodger\'s own reader — for an order email it missed.',
    'Use the message_id from find_order_emails, after the user confirms it\'s the right email. Nothing is lodged yet:',
    'read back the claim number, insurer, work type, insured and address, then offer lodge_order.',
    'If an order already exists for the claim number, that order is returned instead of a new one.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { message_id: { type: 'string', description: 'message_id from find_order_emails.' } },
    required: ['message_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const id = typeof args.message_id === 'string' ? args.message_id.trim() : ''
    if (!/^[0-9a-zA-Z]{8,32}$/.test(id)) return { text: 'Email not found — use find_order_emails for its id.', isError: true }

    const existing = await emailStatus(ctx, id, null)
    if (existing.orderId) return orderResult(ctx, existing.orderId, 'That email is already an order:')

    let orderId: string | null
    try {
      const msg = await extractMessageParts(await getFullMessage(id))
      if (msg.fromEmail.toLowerCase().endsWith(`@${OWN_DOMAIN}`)) {
        return { text: 'That email is one of ours, not an insurer\'s order.', isError: true }
      }
      const parsed = await parseInsurerOrder(msg, null, ctx.tenantId)
      // The user says it's an order, so it's written even if the reader thought
      // otherwise; its reasoning is kept on the audit record.
      orderId = await writeInsurerOrder(
        { ...parsed, isNewOrder: true, isNewOrderReasoning: `Created on request by voice. Reader said: ${parsed.isNewOrderReasoning ?? 'no reason'}` },
        msg,
        ctx.tenantId,
      )
    } catch (err) {
      console.error('[mcp] create_order_from_email failed:', err)
      return { text: `Couldn't read that email into an order: ${err instanceof Error ? err.message : String(err)}. It can be entered by hand on the Insurer Orders page.`, isError: true }
    }
    if (!orderId) return { text: 'The order could not be created. Enter it on the Insurer Orders page.', isError: true }
    return orderResult(ctx, orderId, 'Created the order:')
  },
}

async function orderResult(ctx: McpContext, orderId: string, lead: string): Promise<McpToolResult> {
  const { data, error } = await ctx.supabase
    .from('insurer_orders').select(ORDER_COLUMNS).eq('tenant_id', ctx.tenantId).eq('id', orderId).maybeSingle()
  if (error) throw error
  if (!data) return { text: 'Order not found.', isError: true }
  const order = data as OrderSummaryRow
  const state = order.job_id ? ' It is already lodged.' : ' It is ready to lodge.'
  return { text: `${lead} ${describeOrder(order)}${state}`, data: orderData(order) }
}

export const lodgeOrder: McpTool = {
  name: 'lodge_order',
  title: 'Lodge order',
  description: [
    'Lodges an insurer order as a job, exactly like the Lodge button: creates the job with the next job number and KPI due dates,',
    'plus the inspection, report, quote and invoice its work type needs, and notifies the office.',
    'If a job already has the claim number, the order is linked to that job instead. If another job has the same address with a different claim, nothing is created and the matching jobs are listed.',
    'Read back the claim number, insured and address and get a clear yes first.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { order_id: { type: 'string', description: 'order_id from list_insurer_orders or create_order_from_email.' } },
    required: ['order_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },

  async run(args, ctx): Promise<McpToolResult> {
    const id = typeof args.order_id === 'string' ? args.order_id.trim() : ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { text: 'Order not found — use list_insurer_orders for its id.', isError: true }
    try {
      const result = await lodgeInsurerOrder(ctx.supabase, id, { tenantId: ctx.tenantId })
      return {
        text: result.linkedToExisting
          ? `That claim already has job ${result.jobNumber}, so the order was linked to it.`
          : `Lodged as job ${result.jobNumber}.`,
        data: { job_number: result.jobNumber, job_id: result.jobId, linked_to_existing: !!result.linkedToExisting },
      }
    } catch (err) {
      if (!(err instanceof LodgeError)) throw err
      if (err.status === 409 && Array.isArray(err.details.matchingJobs)) {
        const jobs = err.details.matchingJobs as { jobNumber: string; claimNumber: string | null }[]
        return {
          text: `Not lodged: the same address already has ${jobs.map(j => `job ${j.jobNumber} (claim ${j.claimNumber ?? 'none'})`).join(', ')}. Check in the app whether it belongs to that job.`,
          data: { matching_jobs: jobs },
          isError: true,
        }
      }
      return { text: err.message, data: { status: err.status }, isError: true }
    }
  },
}
