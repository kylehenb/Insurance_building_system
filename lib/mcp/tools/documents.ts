import type { Json } from '@/lib/supabase/database.types'
import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { findJob, money, normaliseJobNumber, spokenDate } from '@/lib/mcp/tools/work-orders'
import {
  DocumentSendError,
  parseDocumentRef,
  quoteDocumentTotal,
  type DocumentRef,
} from '@/lib/documents/send/documents'
import {
  buildDocumentEmailDraft,
  listJobDocuments,
  sendDocumentEmail,
  type DocumentEmailContext,
  type DocumentEmailOverrides,
} from '@/lib/documents/send/email'
import { ATTACH_PROPERTIES, fitJobAttachments, loadJobAttachments, skippedText } from '@/lib/mcp/tools/job-attachments'

// Emailing a job's documents by voice: quotes, reports, invoices (incl.
// excess), TCC and photos. The list is the send dialog's own
// listJobDocuments, and preview/send are the dialog's buildDocumentEmailDraft
// and sendDocumentEmail, so recipients (insurer routing, or the insured for an
// excess invoice), templates, the comms record and "marked sent" all match
// the app.
//
// Re-sending a document is normal, so nothing here refuses a second send —
// except the same documents to the same people within a few minutes, which
// is almost always a retry rather than intent.

const RECENT_EMAILS_SHOWN = 5
/** How far back a previous email of the same document is mentioned */
const PREVIOUS_SEND_DAYS = 60
/** The same documents to the same people inside this window need resend: true */
const DUPLICATE_WINDOW_MINUTES = 10

interface ListedDocument {
  document: DocumentRef
  title: string
  status: string | null
  amount: number | null
  created_at: string | null
}

interface PreviousEmail {
  at: string
  to: string | null
  subject: string | null
  attachments: string[]
}

const emailContext = (ctx: McpContext): DocumentEmailContext =>
  ({ supabase: ctx.supabase, tenantId: ctx.tenantId, actorId: ctx.userId })

/** Document emails sent from the job (the app's document_send records), newest first. */
async function documentEmails(ctx: McpContext, jobId: string, sinceDays: number): Promise<PreviousEmail[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await ctx.supabase
    .from('communications').select('created_at, to_email, subject, attachments')
    .eq('tenant_id', ctx.tenantId).eq('job_id', jobId).eq('source', 'document_send').eq('type', 'email')
    .gte('created_at', since).order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).filter(c => c.created_at).map(c => ({
    at: c.created_at as string,
    to: c.to_email,
    subject: c.subject,
    attachments: attachmentNames(c.attachments),
  }))
}

function attachmentNames(value: Json | null): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(a => (a && typeof a === 'object' && !Array.isArray(a) && typeof a.filename === 'string' ? [a.filename] : []))
}

const addresses = (value: string | null | undefined) =>
  (value ?? '').split(/[,;]/).map(s => s.trim().toLowerCase()).filter(Boolean)

/** Documents argument → refs, via the send route's own validation. */
function parseDocuments(args: Record<string, unknown>): DocumentRef[] | McpToolResult {
  const list = Array.isArray(args.documents) ? args.documents : []
  if (!list.length) return { text: 'Say which documents — use list_job_documents to get them.', isError: true }
  try {
    return list.map(parseDocumentRef)
  } catch (err) {
    if (err instanceof DocumentSendError) return { text: `${err.message} — use list_job_documents to get the documents.`, isError: true }
    throw err
  }
}

const isResult = (v: unknown): v is McpToolResult => !!v && typeof v === 'object' && 'text' in v

function errorResult(err: unknown): McpToolResult {
  if (err instanceof DocumentSendError) return { text: err.message, data: { status: err.status }, isError: true }
  throw err
}

const DOCUMENTS_SCHEMA = {
  type: 'array',
  minItems: 1,
  maxItems: 8,
  description: 'The documents for one email (the first one decides the template and recipients). Copy each "document" from list_job_documents.',
  items: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['quote', 'report', 'invoice', 'tcc', 'photos'] },
      id: { type: 'string', description: 'Quote/report/invoice id; for photos the job id; for a TCC the quote id.' },
      tcc: {
        type: 'object',
        description: 'TCC only: the clearance call — ask the user for these.',
        properties: {
          date: { type: 'string' }, time: { type: 'string' },
          completedBy: { type: 'string', description: 'Who made the call' },
          method: { type: 'string', description: 'e.g. Phone' },
        },
        additionalProperties: false,
      },
    },
    required: ['kind', 'id'],
    additionalProperties: false,
  },
}

export const listJobDocumentsTool: McpTool = {
  name: 'list_job_documents',
  title: 'List job documents',
  description: [
    'Lists the documents that can be emailed from a job — quotes, reports and invoices with their status and amount, and the job\'s photos —',
    'plus the most recent document emails sent from the job.',
    'Each has a "document" value to pass to get_document_email / send_documents.',
    'Several documents can share a name (e.g. old report versions): give their dates and ask which one.',
    'A TCC (telephone clearance certificate) is made from a quote: use kind "tcc" with that quote\'s id and ask for the call details.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { job_number: { type: 'string', description: 'Job number, e.g. IRC1001.' } },
    required: ['job_number'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const { supabase, tenantId } = ctx
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

    const listed = await listJobDocuments({ supabase, tenantId }, job.id)
    const idsOf = (kind: string) => listed.filter(d => d.ref.kind === kind).map(d => d.ref.id)
    const none = { data: null, error: null }
    const quoteIds = idsOf('quote'), reportIds = idsOf('report'), invoiceIds = idsOf('invoice')
    const [quotes, items, reports, invoices, photos, emails] = await Promise.all([
      quoteIds.length ? supabase.from('quotes').select('*').eq('tenant_id', tenantId).in('id', quoteIds) : none,
      quoteIds.length ? supabase.from('scope_items').select('*').eq('tenant_id', tenantId).in('quote_id', quoteIds) : none,
      reportIds.length ? supabase.from('reports').select('id, status, created_at').eq('tenant_id', tenantId).in('id', reportIds) : none,
      invoiceIds.length ? supabase.from('invoices').select('id, status, amount_inc_gst, created_at').eq('tenant_id', tenantId).in('id', invoiceIds) : none,
      supabase.from('photos').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('job_id', job.id),
      documentEmails(ctx, job.id, PREVIOUS_SEND_DAYS),
    ])
    for (const res of [quotes, items, reports, invoices, photos]) if (res.error) throw res.error

    const byId = <T extends { id: string }>(rows: T[] | null) => new Map((rows ?? []).map(r => [r.id, r]))
    const quoteRows = byId(quotes.data), reportRows = byId(reports.data), invoiceRows = byId(invoices.data)

    const documents: ListedDocument[] = listed.map(({ ref, title }) => {
      if (ref.kind === 'quote') {
        const q = quoteRows.get(ref.id)
        const total = q ? quoteDocumentTotal(q, (items.data ?? []).filter(i => i.quote_id === q.id)) : null
        return { document: ref, title, status: q?.status ?? null, amount: total, created_at: q?.created_at ?? null }
      }
      if (ref.kind === 'report') {
        const r = reportRows.get(ref.id)
        return { document: ref, title, status: r?.status ?? null, amount: null, created_at: r?.created_at ?? null }
      }
      const i = invoiceRows.get(ref.id)
      return { document: ref, title, status: i?.status ?? null, amount: i?.amount_inc_gst ?? null, created_at: i?.created_at ?? null }
    })
    const photoCount = photos.count ?? 0
    const recent = emails.slice(0, RECENT_EMAILS_SHOWN)

    const line = (d: ListedDocument) =>
      `- ${d.title}: ${d.status ?? 'no status'}${d.amount != null ? `, ${money(Math.round(d.amount * 100) / 100)}` : ''}${d.created_at ? ` (created ${spokenDate(d.created_at)})` : ''}`
    return {
      text: [
        `${job.job_number}, ${job.property_address ?? 'no address'}:`,
        ...(documents.length ? documents.map(line) : ['- No quotes, reports or invoices.']),
        `- Photos: ${photoCount}.`,
        recent.length
          ? `Recent document emails: ${recent.map(e => `${spokenDate(e.at)} to ${e.to ?? 'unknown'} (${e.attachments.join(', ') || e.subject})`).join('; ')}.`
          : 'No documents have been emailed from this job yet.',
      ].join('\n'),
      data: {
        job_number: job.job_number,
        property_address: job.property_address,
        documents,
        photos: { document: { kind: 'photos', id: job.id }, count: photoCount },
        recent_emails: recent,
      },
    }
  },
}

export const getDocumentEmail: McpTool = {
  name: 'get_document_email',
  title: 'Preview document email',
  description: [
    'Shows the email Send would produce for one or more documents of a job: recipients (the insurer\'s routing, or the insured for an excess invoice),',
    'subject, the standard body from the tenant\'s template, attachments, warnings (draft documents, no recipient on file, already emailed before),',
    'and other documents on the job that could go in the same email. Renders no PDFs and sends nothing.',
    'Use it before send_documents, then read back the recipients, documents and warnings.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { documents: DOCUMENTS_SCHEMA },
    required: ['documents'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const refs = parseDocuments(args)
    if (isResult(refs)) return refs

    let draft
    try {
      draft = await buildDocumentEmailDraft(refs, emailContext(ctx))
    } catch (err) {
      return errorResult(err)
    }

    // Earlier emails of these documents (all documents in one email share a job)
    const jobId = await jobIdOf(refs[0], ctx)
    const previous = jobId ? await documentEmails(ctx, jobId, PREVIOUS_SEND_DAYS) : []
    const warnings = [...draft.warnings]
    for (const a of draft.attachments) {
      const last = previous.find(e => e.attachments.includes(a.filename))
      if (last) warnings.push(`${a.title} was already emailed on ${spokenDate(last.at)} to ${last.to ?? 'unknown'}.`)
    }

    return {
      text: [
        `To: ${draft.to || 'no address on file'}${draft.cc ? `. Cc: ${draft.cc}` : ''}.`,
        `Attachments: ${draft.attachments.map(a => a.title).join(', ')}.`,
        ...(warnings.length ? [`Warnings: ${warnings.join(' ')}`] : []),
        ...(draft.otherDocuments.length ? [`Could also attach: ${draft.otherDocuments.map(d => d.title).join(', ')}.`] : []),
        `Subject: ${draft.subject}`,
        'Body:',
        draft.bodyText,
      ].join('\n'),
      data: {
        to: draft.to || null,
        cc: draft.cc || null,
        subject: draft.subject,
        body: draft.bodyText,
        attachments: draft.attachments.map(a => ({ document: a.ref, title: a.title, filename: a.filename })),
        audience: draft.audience,
        warnings,
        other_documents: draft.otherDocuments.map(d => ({ document: d.ref, title: d.title })),
        template_name: draft.templateName,
      },
    }
  },
}

/** The job a document belongs to (photos refs are the job itself). */
async function jobIdOf(ref: DocumentRef, ctx: McpContext): Promise<string | null> {
  if (ref.kind === 'photos') return ref.id
  const table = ref.kind === 'report' ? 'reports' : ref.kind === 'invoice' ? 'invoices' : 'quotes'
  const { data } = await ctx.supabase.from(table).select('job_id').eq('tenant_id', ctx.tenantId).eq('id', ref.id).maybeSingle()
  return data?.job_id ?? null
}

export const sendDocuments: McpTool = {
  name: 'send_documents',
  title: 'Send documents',
  description: [
    'Emails one or more documents of a job as PDFs in one email, exactly like Send on the job, and marks them sent (quotes, reports, invoices — invoices also go to the accounting system).',
    'ONLY call this after get_document_email, once you have read back the recipients, the documents and any warnings and the user has clearly said yes.',
    'Leave out to, cc, subject and body to send the standard email. If there is no recipient on file, ask the user for one and pass it as to.',
    'attach_photos ("2", "45-47", a label) / attach_files add the job\'s photos and uploaded files as they are (the "photos" document is all photos as one PDF).',
    'The same documents to the same people within 10 minutes are refused as a likely repeat; pass resend: true only if the user confirms they want it sent again.',
    'If a call returns an error, tell the user what it says instead of retrying.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      documents: DOCUMENTS_SCHEMA,
      to: { type: 'string', description: 'Send to these addresses instead of the default (comma-separate several). Only when the user gave them.' },
      cc: { type: 'string', description: 'Replace the default Cc. Empty string for no Cc.' },
      subject: { type: 'string', description: 'Replacement subject. Leave out for the standard subject.' },
      body: { type: 'string', description: 'Full replacement email body (plain text; the standard email\'s formatting such as bold or colours is not kept). Keep the {signature} line where it is: it becomes the email signature. Start from the standard body from get_document_email and apply the user\'s changes.' },
      resend: { type: 'boolean', description: 'The user confirmed sending the same documents to the same people again within 10 minutes.' },
      attach_photos: ATTACH_PROPERTIES.attach_photos,
      attach_files: ATTACH_PROPERTIES.attach_files,
    },
    required: ['documents'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  permission: 'send.documents',

  async run(args, ctx): Promise<McpToolResult> {
    const refs = parseDocuments(args)
    if (isResult(refs)) return refs

    const str = (k: string) => (typeof args[k] === 'string' ? args[k] as string : undefined)
    const nonEmpty = (k: string) => (str(k)?.trim() ? str(k) : undefined)
    const overrides: DocumentEmailOverrides = { to: nonEmpty('to'), cc: str('cc'), subject: nonEmpty('subject'), body: nonEmpty('body') }
    const ectx = emailContext(ctx)

    try {
      const draft = await buildDocumentEmailDraft(refs, ectx)
      const titles = draft.attachments.map(a => a.title).join(', ')
      const sentTo = overrides.to ?? draft.to

      // The same documents to the same people a few minutes ago: almost always a retry
      if (args.resend !== true) {
        const jobId = await jobIdOf(refs[0], ctx)
        const recent = jobId ? await documentEmails(ctx, jobId, DUPLICATE_WINDOW_MINUTES / (24 * 60)) : []
        const to = addresses(sentTo)
        const repeat = recent.find(e =>
          draft.attachments.every(a => e.attachments.includes(a.filename)) &&
          addresses(e.to).some(addr => to.includes(addr)))
        if (repeat) {
          const minutes = Math.max(1, Math.round((Date.now() - new Date(repeat.at).getTime()) / 60000))
          return {
            text: `Not sent: ${titles} went to ${repeat.to} ${minutes} minute${minutes === 1 ? '' : 's'} ago. Ask the user if they really want it sent again; if so, call again with resend: true.`,
            data: { duplicate_of: repeat },
            isError: true,
          }
        }
      }

      // The job's own photos and files, alongside the PDFs
      const extraNames: string[] = []
      if ((Array.isArray(args.attach_photos) && args.attach_photos.length) || (Array.isArray(args.attach_files) && args.attach_files.length)) {
        const jobId = await jobIdOf(refs[0], ctx)
        const { data: job } = jobId
          ? await ctx.supabase.from('jobs').select('id, job_number').eq('tenant_id', ctx.tenantId).eq('id', jobId).maybeSingle()
          : { data: null }
        if (!job) return { text: 'Couldn\'t find the documents\' job for the photos.', isError: true }
        const loaded = await loadJobAttachments({ attach_photos: args.attach_photos, attach_files: args.attach_files }, ctx, job)
        if (isResult(loaded)) return loaded
        const fit = await fitJobAttachments(loaded)
        if (fit.skipped.length) return { text: `Not sent. ${skippedText(fit)} Send them in a second email.`, isError: true }
        overrides.extraAttachments = fit.kept
        extraNames.push(...fit.kept.map(f => f.label))
      }

      const result = await sendDocumentEmail(refs, ectx, overrides)
      const changes = result.statusChanges.map(c => c.description)
      return {
        text: `Emailed ${[titles, ...extraNames].join(', ')} to ${sentTo}.${changes.length ? ` ${changes.join('. ')}.` : ''}`,
        data: { sent_to: sentTo, communication_id: result.communicationId, status_changes: changes, ...(extraNames.length ? { extra_attachments: extraNames } : {}) },
      }
    } catch (err) {
      return errorResult(err)
    }
  },
}
