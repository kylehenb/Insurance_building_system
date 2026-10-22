import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { summariseWorkOrder, money, type WorkOrderSummary } from '@/lib/mcp/tools/work-orders'
import {
  buildWorkOrderEmailDraft,
  sendWorkOrderEmail,
  WorkOrderEmailError,
  type WorkOrderEmailOverrides,
} from '@/lib/work-orders/work-order-email'
import { WorkOrderPdfError } from '@/lib/work-orders/work-order-pdf'

// Sending a work order by voice. Both tools call the same functions as the
// Work Orders tab's Auto send / Customise send (lib/work-orders/work-order-email.ts),
// so the PDF, photos, template, communications record and Gary hand-off are
// identical, and an already-sent work order is refused there.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const WORK_ORDER_ID = {
  type: 'string',
  description: 'The work_order_id from find_work_orders.',
}

/** The work order, or a tool result explaining why it can't be used. */
async function loadWorkOrder(args: Record<string, unknown>, ctx: McpContext): Promise<WorkOrderSummary | McpToolResult> {
  const id = typeof args.work_order_id === 'string' ? args.work_order_id.trim() : ''
  const summary = UUID_RE.test(id) ? await summariseWorkOrder(id, ctx) : null
  return summary ?? { text: 'Work order not found — use find_work_orders to get its id.', isError: true }
}

const isResult = (v: WorkOrderSummary | McpToolResult): v is McpToolResult => 'text' in v

function errorResult(err: unknown): McpToolResult {
  if (err instanceof WorkOrderEmailError || err instanceof WorkOrderPdfError) {
    return { text: err.message, data: { status: err.status }, isError: true }
  }
  throw err
}

const describeTrade = (s: WorkOrderSummary) =>
  s.business_name && s.business_name !== s.trade ? `${s.trade} (${s.business_name})` : s.trade

export const getWorkOrderEmail: McpTool = {
  name: 'get_work_order_email',
  title: 'Preview work order email',
  description: [
    'Shows what Send would email for a work order: recipient, amount, subject, the standard body from the tenant\'s template,',
    'and the attachments (the work order PDF, plus the job\'s photos PDF when the job has photos).',
    'Use it before send_work_order: read back the trade, recipient, amount and warnings, and ask whether to send the standard email or change it.',
    'Does not send anything.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { work_order_id: WORK_ORDER_ID },
    required: ['work_order_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const wo = await loadWorkOrder(args, ctx)
    if (isResult(wo)) return wo
    const where = `${describeTrade(wo)} on ${wo.job_number}, ${wo.property_address ?? 'no address'}`

    if (wo.sent) {
      return {
        text: `${where}: ${wo.warnings.join(' ')} It can't be sent again from here.`,
        data: { ...wo },
      }
    }

    let draft
    try {
      draft = await buildWorkOrderEmailDraft(wo.work_order_id, ctx)
    } catch (err) {
      return errorResult(err)
    }
    const attachments = [draft.attachmentName, ...(draft.photos ? [draft.photos.attachmentName] : [])]

    return {
      text: [
        `${where}.`,
        `To: ${draft.to || 'no email address on file'}. Amount: ${wo.amount ? money(wo.amount) : '$0'}.`,
        ...(wo.warnings.length ? [`Warnings: ${wo.warnings.join(' ')}`] : []),
        `Attachments: ${draft.attachmentName}${draft.photos ? `, and ${draft.photos.count} photos as ${draft.photos.attachmentName}` : ' (the job has no photos)'}.`,
        `Subject: ${draft.subject}`,
        'Body:',
        draft.body,
      ].join('\n'),
      data: {
        ...wo,
        to: draft.to || null,
        subject: draft.subject,
        body: draft.body,
        attachments,
        photo_count: draft.photos?.count ?? 0,
        template_name: draft.templateName,
      },
    }
  },
}

export const sendWorkOrder: McpTool = {
  name: 'send_work_order',
  title: 'Send work order',
  description: [
    'Emails a work order to its trade with the work order PDF (and the job\'s photos PDF unless include_photos is false),',
    'then hands it to Gary, exactly like Send in the app. A work order that has already been sent is refused.',
    'ONLY call this after get_work_order_email, once you have read back the trade, recipient, amount and any warnings',
    'and the user has clearly said yes. Leave out body and subject to send the standard email.',
    'If the trade has no email address, ask the user who to send it to and pass it as to.',
    'Call it once per confirmed request — if it returns an error, tell the user what it says instead of retrying.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      work_order_id: WORK_ORDER_ID,
      to: { type: 'string', description: 'Send to this address instead of the trade\'s email (comma-separate several). Only when the user gave an address.' },
      subject: { type: 'string', description: 'Replacement subject. Leave out for the standard subject.' },
      body: { type: 'string', description: 'Full replacement email body (plain text). Start from the standard body from get_work_order_email and apply the user\'s changes. Leave out for the standard body.' },
      include_photos: { type: 'boolean', description: 'Attach the job\'s photos PDF. Default true.' },
    },
    required: ['work_order_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },

  async run(args, ctx): Promise<McpToolResult> {
    const wo = await loadWorkOrder(args, ctx)
    if (isResult(wo)) return wo

    const str = (k: string) => (typeof args[k] === 'string' && (args[k] as string).trim() ? args[k] as string : undefined)
    const overrides: WorkOrderEmailOverrides = {
      to: str('to'),
      subject: str('subject'),
      body: str('body'),
      includePhotos: args.include_photos !== false,
    }

    let communicationId: string | null
    try {
      ({ communicationId } = await sendWorkOrderEmail(wo.work_order_id, ctx, overrides))
    } catch (err) {
      return errorResult(err)
    }

    const recipient = overrides.to ?? wo.recipient
    const after = await summariseWorkOrder(wo.work_order_id, ctx)
    const next = after?.gary_state === 'waiting_on_dependent'
      ? 'Gary will contact them once the earlier trade is done.'
      : 'Gary is now waiting on their reply.'
    return {
      text: `Sent the ${describeTrade(wo)} work order for ${wo.job_number} to ${recipient}${overrides.includePhotos ? '' : ', without photos'}. ${next}`,
      data: { ...(after ?? wo), sent_to: recipient, communication_id: communicationId },
    }
  },
}
