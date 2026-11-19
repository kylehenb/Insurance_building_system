import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { isToolResult, jobFromArgs } from '@/lib/mcp/tools/excess'
import { pickContractor } from '@/lib/mcp/tools/work-order-edit'
import { describeService, loadJobServices, loadOpenServices, runServiceAction, ServiceError, type ServiceAction, type ServiceView } from '@/lib/jobs/services'
import { SERVICE_WORK_TYPES, WORK_TYPE_LABELS, mapWorkOrderType, isServiceWorkType } from '@/lib/insurer-orders/work-order-type'

// Requested services by voice (lib/jobs/services.ts): what the insurer asked
// for beyond the BAR — a make safe, roof report, leak detection or specialist
// report — and who's doing it. The same functions as the job page's
// Requested services panel (/api/jobs/[jobId]/services).

const SERVICE_HELP = SERVICE_WORK_TYPES.map(t => `${t} (${WORK_TYPE_LABELS[t]})`).join(', ')

function serviceData(v: ServiceView) {
  return {
    service_id: v.service.id, service: v.service.service_type, label: v.label, status: v.service.status,
    next_step: v.stage.text, urgent: v.stage.urgent, open: v.stage.open,
    work_order_id: v.service.work_order_id, report: v.report?.ref ?? null, invoice: v.invoice?.ref ?? null,
  }
}

function errorResult(err: unknown): McpToolResult {
  if (err instanceof ServiceError) return { text: err.message, data: { status: err.status }, isError: true }
  throw err
}

/** The job's open service of the type the user said ("make safe", "roof report"…) */
async function serviceFromArgs(args: Record<string, unknown>, ctx: McpContext): Promise<{ jobNumber: string; jobId: string; view: ServiceView } | McpToolResult> {
  const job = await jobFromArgs(args, ctx)
  if (isToolResult(job)) return job
  const type = mapWorkOrderType(typeof args.service === 'string' ? args.service : '')
  if (!isServiceWorkType(type)) return { text: `Which service — ${SERVICE_HELP}?`, isError: true }
  const views = await loadJobServices(ctx.supabase, ctx.tenantId, job.id)
  const view = views.find(v => v.service.service_type === type)
  if (!view) {
    return {
      text: `${job.job_number} has no open ${WORK_TYPE_LABELS[type].toLowerCase()}.${views.length ? ` Open: ${views.map(v => v.label).join(', ')}.` : ''} Use arrange_service with how "add" to add one.`,
      isError: true,
    }
  }
  return { jobNumber: job.job_number, jobId: job.id, view }
}

const resultText = (r: { message: string; warnings: string[] }) => [r.message, ...r.warnings].join(' ')

export const listRequestedServices: McpTool = {
  name: 'list_requested_services',
  title: 'List requested services',
  description: [
    'The make safes, roof reports, leak detections and specialist reports insurers asked for, and where each is up to:',
    'not yet arranged, with a trade, done in-house, or its report and invoice still to send. With job_number, that job\'s (finished ones too);',
    'without, every open one across the jobs, unarranged make safes first. Each stays open until its report and invoice have gone to the insurer.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { job_number: { type: 'string', description: 'A job, e.g. IRC1042. Leave out for every open service.' } },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    if (typeof args.job_number === 'string' && args.job_number.trim()) {
      const job = await jobFromArgs(args, ctx)
      if (isToolResult(job)) return job
      const views = await loadJobServices(ctx.supabase, ctx.tenantId, job.id, { includeClosed: true })
      if (!views.length) return { text: `${job.job_number} has no requested services.`, data: { services: [] } }
      return {
        text: [`${job.job_number}:`, ...views.map(v => `- ${describeService(v.label, v.stage)}`)].join('\n'),
        data: { job_number: job.job_number, services: views.map(serviceData) },
      }
    }
    const open = await loadOpenServices(ctx.supabase, ctx.tenantId)
    if (!open.length) return { text: 'No requested services are open.', data: { services: [] } }
    return {
      text: [`${open.length} open:`, ...open.map(v => `- ${v.job.job_number} ${describeService(v.label, v.stage)}`)].join('\n'),
      data: { services: open.map(v => ({ job_number: v.job.job_number, property_address: v.job.property_address, ...serviceData(v) })) },
    }
  },
}

export const arrangeService: McpTool = {
  name: 'arrange_service',
  title: 'Arrange a requested service',
  description: [
    'Decides who does a make safe, roof report, leak detection or specialist report on a job — as the job page\'s Requested services panel does. how:',
    '"in_house" — we do it: creates the draft report and an invoice at the client\'s rates;',
    '"trade" — a trade does it: creates a work order for it (optionally with the contractor), to send with send_work_order;',
    '"not_needed" — give the reason; "add" — add one the order didn\'t ask for.',
    'It can switch either way until its report has been sent: an unsent work order is removed, a draft report and invoice are voided. If the work order had already gone, say the trade needs telling.',
    `service is one of ${SERVICE_HELP}. Read back what will happen and get a clear yes first.`,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      job_number: { type: 'string', description: 'The job, e.g. IRC1042.' },
      service: { type: 'string', enum: [...SERVICE_WORK_TYPES] },
      how: { type: 'string', enum: ['in_house', 'trade', 'not_needed', 'add'] },
      contractor: { type: 'string', description: 'With how "trade": the contractor\'s business or contact name, if the user named one.' },
      reason: { type: 'string', description: 'With how "not_needed": why.' },
    },
    required: ['job_number', 'service', 'how'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  permission: 'services.manage',

  async run(args, ctx): Promise<McpToolResult> {
    try {
      let action: ServiceAction
      if (args.how === 'add') {
        const job = await jobFromArgs(args, ctx)
        if (isToolResult(job)) return job
        action = { kind: 'add', jobId: job.id, type: mapWorkOrderType(typeof args.service === 'string' ? args.service : '') ?? '' }
      } else {
        const found = await serviceFromArgs(args, ctx)
        if (isToolResult(found)) return found
        const serviceId = found.view.service.id
        if (args.how === 'in_house') action = { kind: 'in_house', serviceId }
        else if (args.how === 'trade') {
          let tradeId: string | null = null
          if (typeof args.contractor === 'string' && args.contractor.trim()) {
            const pick = await pickContractor(args.contractor.trim(), ctx)
            if (isToolResult(pick)) return pick
            tradeId = pick.id
          }
          action = { kind: 'trade', serviceId, tradeId }
        } else if (args.how === 'not_needed') {
          const reason = typeof args.reason === 'string' ? args.reason.trim() : ''
          if (reason.length < 3) return { text: 'Why isn\'t it needed?', isError: true }
          action = { kind: 'not_needed', serviceId, reason: reason.slice(0, 500) }
        } else return { text: 'how must be in_house, trade, not_needed or add.', isError: true }
      }
      const result = await runServiceAction(ctx.supabase, ctx.tenantId, ctx.userId || null, action)
      return { text: resultText(result), data: { service_id: result.service.id, status: result.service.status, work_order_id: result.service.work_order_id, warnings: result.warnings } }
    } catch (err) {
      return errorResult(err)
    }
  },
}

export const prepareServiceInvoice: McpTool = {
  name: 'prepare_service_invoice',
  title: 'Prepare a trade service\'s report and invoice',
  description: [
    'Once the trade has done a make safe, roof report, leak detection or specialist report: creates its report (to attach the trade\'s own report to when sending)',
    'and the invoice to the insurer at the trade\'s cost plus the client\'s builder\'s margin, plus GST. The cost comes from the trade\'s invoice, else the work order\'s agreed amount;',
    'if neither is on record it says so — ask the user for the trade\'s cost ex GST and pass it as cost. Read back the amount and get a yes first. Nothing is sent: use send_documents after.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      job_number: { type: 'string', description: 'The job, e.g. IRC1042.' },
      service: { type: 'string', enum: [...SERVICE_WORK_TYPES] },
      cost: { type: 'number', description: 'The trade\'s cost ex GST, only when it isn\'t on record.' },
    },
    required: ['job_number', 'service'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  permission: 'services.manage',

  async run(args, ctx): Promise<McpToolResult> {
    try {
      const found = await serviceFromArgs(args, ctx)
      if (isToolResult(found)) return found
      const cost = typeof args.cost === 'number' && Number.isFinite(args.cost) && args.cost > 0 ? args.cost : null
      const result = await runServiceAction(ctx.supabase, ctx.tenantId, ctx.userId || null, { kind: 'prepare', serviceId: found.view.service.id, cost })
      return { text: resultText(result), data: { service_id: result.service.id, report_id: result.service.report_id, invoice_id: result.service.invoice_id } }
    } catch (err) {
      return errorResult(err)
    }
  },
}
