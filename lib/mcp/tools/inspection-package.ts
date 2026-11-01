import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { findJob, normaliseJobNumber, spokenDate } from '@/lib/mcp/tools/work-orders'
import { DocumentSendError } from '@/lib/documents/send/documents'
import {
  buildDocumentEmailDraft,
  sendDocumentEmail,
  type DocumentEmailContext,
  type DocumentEmailOverrides,
} from '@/lib/documents/send/email'
import { INSPECTION_SENT_STATUS, inspectionPackage } from '@/lib/documents/send/inspection-package'
import { ATTACH_PROPERTIES, fitJobAttachments, loadJobAttachments, skippedText } from '@/lib/mcp/tools/job-attachments'

// The Inspections tab's Compile & Submit Package by voice: an inspection's
// report, quote and invoice emailed to the insurer as a reply in the insurer
// order's email thread, then the inspection marked Sent and Locked. The
// documents come from inspectionPackage and the email from the send dialog's
// own buildDocumentEmailDraft / sendDocumentEmail (replyToOrder, inspectionId).

interface InspectionRow {
  id: string
  inspection_ref: string | null
  status: string | null
  scheduled_date: string | null
  created_at: string | null
}

const emailContext = (ctx: McpContext): DocumentEmailContext =>
  ({ supabase: ctx.supabase, tenantId: ctx.tenantId, actorId: ctx.userId })

const describe = (i: InspectionRow) =>
  `${i.inspection_ref || 'Inspection'}${i.scheduled_date ? ` on ${spokenDate(i.scheduled_date)}` : ''}${i.status === INSPECTION_SENT_STATUS ? ' (package already sent)' : ''}`

/**
 * The job and which of its inspections: the one named, the only one, or the
 * only one whose package hasn't gone yet. Otherwise asks which.
 */
async function pickInspection(args: Record<string, unknown>, ctx: McpContext): Promise<{ job: { id: string; job_number: string }; inspection: InspectionRow } | McpToolResult> {
  const jobNumber = normaliseJobNumber(typeof args.job_number === 'string' ? args.job_number : '')
  if (!jobNumber) return { text: 'Which job?', isError: true }
  const { job, closeMatches } = await findJob(jobNumber, ctx)
  if (!job) {
    return {
      text: closeMatches.length ? `No job ${jobNumber}. Did you mean ${closeMatches.join(', ')}?` : `No job ${jobNumber} found.`,
      data: { job_number: jobNumber, close_matches: closeMatches },
      isError: true,
    }
  }

  const { data, error } = await ctx.supabase.from('inspections').select('id, inspection_ref, status, scheduled_date, created_at')
    .eq('tenant_id', ctx.tenantId).eq('job_id', job.id).order('created_at', { ascending: true })
  if (error) throw error
  const all = (data ?? []) as InspectionRow[]
  if (!all.length) return { text: `${job.job_number} has no inspections.`, isError: true }

  const wanted = typeof args.inspection_ref === 'string' ? args.inspection_ref.trim().toLowerCase() : ''
  const named = wanted ? all.filter(i => (i.inspection_ref ?? '').toLowerCase() === wanted) : []
  if (wanted && !named.length) {
    return { text: `No inspection ${args.inspection_ref} on ${job.job_number}. It has: ${all.map(describe).join('; ')}.`, isError: true }
  }
  const unsent = all.filter(i => i.status !== INSPECTION_SENT_STATUS)
  const choice = named[0] ?? (all.length === 1 ? all[0] : unsent.length === 1 ? unsent[0] : null)
  if (!choice) {
    return {
      text: `${job.job_number} has ${all.length} inspections: ${all.map(describe).join('; ')}. Which one? Pass its inspection_ref.`,
      data: { inspections: all.map(i => ({ inspection_ref: i.inspection_ref, status: i.status, scheduled_date: i.scheduled_date })) },
      isError: true,
    }
  }
  return { job, inspection: choice }
}

const isResult = (v: unknown): v is McpToolResult => !!v && typeof v === 'object' && 'text' in v

function errorResult(err: unknown): McpToolResult {
  if (err instanceof DocumentSendError) return { text: err.message, data: { status: err.status }, isError: true }
  throw err
}

const PICK_PROPERTIES = {
  job_number: { type: 'string', description: 'Job number, e.g. IRC1001.' },
  inspection_ref: { type: 'string', description: 'Which inspection, when the job has more than one (its reference). Leave out when there is only one, or only one not yet sent.' },
}

export const getInspectionPackage: McpTool = {
  name: 'get_inspection_package',
  title: 'Preview inspection package',
  description: [
    'Shows the inspection package for a job — the documents Compile & Submit Package on the Inspections tab would send (the report, quote and invoice, plus any extra reports and their invoices)',
    'and the email it would send: recipients, subject, body and warnings. It goes as a reply in the insurer\'s original order email thread, with that email quoted underneath.',
    'Renders no PDFs and sends nothing. Use it before send_inspection_package, then read back the recipients, documents and warnings.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: PICK_PROPERTIES,
    required: ['job_number'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const picked = await pickInspection(args, ctx)
    if (isResult(picked)) return picked
    const { job, inspection } = picked
    try {
      const pkg = await inspectionPackage(emailContext(ctx), inspection.id)
      const draft = await buildDocumentEmailDraft(pkg.documents, emailContext(ctx), { replyToOrder: true })
      const warnings = [...draft.warnings]
      if (inspection.status === INSPECTION_SENT_STATUS) warnings.unshift('This inspection\'s package has already been sent.')
      return {
        text: [
          `${describe(inspection)} on ${job.job_number}.`,
          `To: ${draft.to || 'no address on file'}${draft.cc ? `. Cc: ${draft.cc}` : ''}.`,
          `Attachments: ${draft.attachments.map(a => a.title).join(', ')}.`,
          draft.replyToOrder ? 'Goes as a reply in the insurer\'s order email thread, with the order email quoted underneath.' : 'Goes as a new email.',
          ...(warnings.length ? [`Warnings: ${warnings.join(' ')}`] : []),
          `Subject: ${draft.subject}`,
          'Body:',
          draft.bodyText,
        ].join('\n'),
        data: {
          job_number: job.job_number,
          inspection_ref: inspection.inspection_ref,
          inspection_status: inspection.status,
          to: draft.to || null,
          cc: draft.cc || null,
          subject: draft.subject,
          body: draft.bodyText,
          attachments: draft.attachments.map(a => ({ document: a.ref, title: a.title, filename: a.filename })),
          reply_to_order: !!draft.replyToOrder,
          warnings,
        },
      }
    } catch (err) {
      return errorResult(err)
    }
  },
}

export const sendInspectionPackage: McpTool = {
  name: 'send_inspection_package',
  title: 'Send inspection package',
  description: [
    'Emails a job\'s inspection package to the insurer, exactly like Compile & Submit Package on the Inspections tab: the report, quote and invoice (plus any extra reports and their invoices) as PDFs,',
    'as a reply in the insurer\'s original order email thread. Marks the documents sent and locked (the invoice also goes to the accounting system) and the inspection Sent and Locked.',
    'ONLY call this after get_inspection_package, once you have read back the recipients, the documents and any warnings and the user has clearly said yes.',
    'Leave out to, cc, subject and body to send the standard email. Keep the subject as it is so it stays in the order thread. If there is no recipient on file, ask the user for one and pass it as to.',
    'attach_photos ("2", "45-47", a label) / attach_files add the job\'s photos and uploaded files as they are.',
    'A package that has already been sent is refused; pass resend: true only if the user confirms they want it sent again.',
    'If a call returns an error, tell the user what it says instead of retrying.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      ...PICK_PROPERTIES,
      to: { type: 'string', description: 'Send to these addresses instead of the default (comma-separate several). Only when the user gave them.' },
      cc: { type: 'string', description: 'Replace the default Cc. Empty string for no Cc.' },
      subject: { type: 'string', description: 'Replacement subject. Leave out to keep the order email\'s subject (a different subject may start a new conversation).' },
      body: { type: 'string', description: 'Full replacement email body (plain text). Keep the {signature} line where it is: it becomes the email signature. Start from the body from get_inspection_package and apply the user\'s changes.' },
      resend: { type: 'boolean', description: 'The user confirmed sending a package that has already been sent.' },
      attach_photos: ATTACH_PROPERTIES.attach_photos,
      attach_files: ATTACH_PROPERTIES.attach_files,
    },
    required: ['job_number'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  permission: 'send.documents',

  async run(args, ctx): Promise<McpToolResult> {
    const picked = await pickInspection(args, ctx)
    if (isResult(picked)) return picked
    const { job, inspection } = picked
    if (inspection.status === INSPECTION_SENT_STATUS && args.resend !== true) {
      return {
        text: `Not sent: the package for ${describe(inspection)} has already been sent. Ask the user if they want it sent again; if so, call again with resend: true.`,
        isError: true,
      }
    }

    const str = (k: string) => (typeof args[k] === 'string' ? args[k] as string : undefined)
    const nonEmpty = (k: string) => (str(k)?.trim() ? str(k) : undefined)
    const overrides: DocumentEmailOverrides = {
      to: nonEmpty('to'), cc: str('cc'), subject: nonEmpty('subject'), body: nonEmpty('body'),
      replyToOrder: true, inspectionId: inspection.id,
    }
    const ectx = emailContext(ctx)

    try {
      const pkg = await inspectionPackage(ectx, inspection.id)
      const draft = await buildDocumentEmailDraft(pkg.documents, ectx, { replyToOrder: true })

      const extraNames: string[] = []
      if ((Array.isArray(args.attach_photos) && args.attach_photos.length) || (Array.isArray(args.attach_files) && args.attach_files.length)) {
        const loaded = await loadJobAttachments({ attach_photos: args.attach_photos, attach_files: args.attach_files }, ctx, job)
        if (isResult(loaded)) return loaded
        const fit = await fitJobAttachments(loaded)
        if (fit.skipped.length) return { text: `Not sent. ${skippedText(fit)} Send them in a second email.`, isError: true }
        overrides.extraAttachments = fit.kept
        extraNames.push(...fit.kept.map(f => f.label))
      }

      const result = await sendDocumentEmail(pkg.documents, ectx, overrides)
      const sentTo = overrides.to ?? draft.to
      const changes = result.statusChanges.map(c => c.description)
      const titles = [...draft.attachments.map(a => a.title), ...extraNames].join(', ')
      return {
        text: `Emailed ${titles} to ${sentTo}${draft.replyToOrder ? ' as a reply to the order email' : ''}.${changes.length ? ` ${changes.join('. ')}.` : ''}`,
        data: {
          sent_to: sentTo,
          communication_id: result.communicationId,
          reply_to_order: !!draft.replyToOrder,
          status_changes: changes,
          ...(extraNames.length ? { extra_attachments: extraNames } : {}),
        },
      }
    } catch (err) {
      return errorResult(err)
    }
  },
}
