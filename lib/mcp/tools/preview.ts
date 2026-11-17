import type { McpTool, McpToolResult } from '@/lib/mcp/server'
import { summariseWorkOrder } from '@/lib/mcp/tools/work-orders'
import { describePreview, parsePreviewTarget, previewLink, PreviewError, PREVIEW_LINK_HOURS, renderPreview, type PreviewTarget } from '@/lib/documents/preview'
import { DocumentSendError } from '@/lib/documents/send/documents'
import { PrintDataError } from '@/lib/documents/print-data'
import { WorkOrderPdfError } from '@/lib/work-orders/work-order-pdf'
import { renderPdfPages } from '@/lib/pdf/render-pdf-pages'
import { downscaleImage } from '@/lib/images/downscale'

// "Show me the quote": a link to the PDF exactly as it would be sent, to open
// on the phone, and (look: true) its pages for Claude to read. Sends nothing
// and marks nothing sent (lib/documents/preview.ts, tech spec §10b).

const MAX_PAGES_SHOWN = 3

export const previewDocument: McpTool = {
  name: 'preview_document',
  title: 'Preview document',
  description: [
    'Gives the user a link to open the actual PDF of a work order, quote, report, invoice, TCC or the job\'s photos — exactly as it would be sent — so they can look at it before it goes out.',
    'Nothing is emailed and nothing is marked sent. Use it for "show me the quote", "let me see the work order", "send me the invoice to look at".',
    'Pass work_order_id (from find_work_orders) for a work order, or document (from list_job_documents) for the rest.',
    `Always give the user the link as it is (it opens without signing in and stops working after ${PREVIEW_LINK_HOURS} hours).`,
    'look: true also shows you the first pages, to check something on it or read it out; leave it off when the user just wants to see it.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      work_order_id: { type: 'string', description: 'For a work order: its work_order_id from find_work_orders.' },
      document: {
        type: 'object',
        description: 'For a quote, report, invoice, TCC or photos: the "document" from list_job_documents.',
        properties: {
          kind: { type: 'string', enum: ['quote', 'report', 'invoice', 'tcc', 'photos'] },
          id: { type: 'string' },
          tcc: {
            type: 'object',
            properties: { date: { type: 'string' }, time: { type: 'string' }, completedBy: { type: 'string' }, method: { type: 'string' } },
            additionalProperties: false,
          },
        },
        required: ['kind', 'id'],
        additionalProperties: false,
      },
      look: { type: 'boolean', description: `Also show you the first ${MAX_PAGES_SHOWN} pages as images.` },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const woId = typeof args.work_order_id === 'string' ? args.work_order_id.trim() : ''
    if (!woId && !args.document) return { text: 'Which document? Give a work_order_id from find_work_orders or a document from list_job_documents.', isError: true }
    if (woId && args.document) return { text: 'One document at a time — a work order or a document, not both.', isError: true }
    const pctx = { supabase: ctx.supabase, tenantId: ctx.tenantId }

    try {
      const target: PreviewTarget = parsePreviewTarget(woId ? { kind: 'work_order', id: woId } : args.document)
      let title: string
      let warnings: string[] = []
      if (target.kind === 'work_order') {
        const wo = await summariseWorkOrder(target.id, ctx)
        if (!wo) return { text: 'Work order not found — use find_work_orders to get its id.', isError: true }
        title = `the ${wo.business_name && wo.business_name !== wo.trade ? `${wo.trade} (${wo.business_name})` : wo.trade} work order on ${wo.job_number}${wo.sent ? '' : ' (draft — not sent yet)'}`
      } else {
        const d = await describePreview(target, pctx)
        title = d.title
        warnings = d.warnings
      }
      const link = previewLink(ctx.tenantId, target)

      const images: { data: string; mimeType: string }[] = []
      let pagesNote = ''
      if (args.look === true) {
        const { pdf } = await renderPreview(target, pctx)
        const pages = await renderPdfPages(pdf, { widthPx: 1600, format: 'jpeg', quality: 0.8 })
        for (const p of pages.slice(0, MAX_PAGES_SHOWN)) {
          const img = await downscaleImage(p.image)
          images.push({ data: img.data.toString('base64'), mimeType: img.mimeType })
        }
        pagesNote = ` Showing you page${images.length === 1 ? '' : 's'} 1${images.length > 1 ? `–${images.length}` : ''} of ${pages.length}.`
      }

      return {
        text: [
          `Here's ${title} to look at: ${link}`,
          `It opens the PDF as it would be sent, without signing in, for the next ${PREVIEW_LINK_HOURS} hours. Nothing has been sent or marked sent.${pagesNote}`,
          ...(warnings.length ? [`Worth a look before sending: ${warnings.join(' ')}`] : []),
        ].join('\n'),
        data: { title, link, expires_in_hours: PREVIEW_LINK_HOURS, warnings },
        ...(images.length ? { images } : {}),
      }
    } catch (err) {
      if (err instanceof PreviewError || err instanceof DocumentSendError || err instanceof PrintDataError || err instanceof WorkOrderPdfError) {
        return { text: err.message, isError: true }
      }
      throw err
    }
  },
}
