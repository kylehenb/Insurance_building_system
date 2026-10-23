import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { money, spokenDate } from '@/lib/mcp/tools/work-orders'
import { describeExcess, isToolResult, jobFromArgs } from '@/lib/mcp/tools/excess'
import {
  getSendDialogDefaults,
  listSigningRequestsForJob,
  resendSigningRequest,
  sendForSignature,
  type SendDialogDefaults,
} from '@/lib/signing/service'
import { SigningError, type SigningActor } from '@/lib/signing/provider'
import type { SigningDocumentTypeKey, SigningRequestSummary } from '@/lib/signing/types'
import { SIGNING_DOCUMENT_CATALOG, signingDocumentLabel, suggestDocumentType } from '@/lib/signing/documents/catalog'
import { EXCESS_WAIVER_REASONS, parseExcessChoice } from '@/lib/excess/decision'
import { ExcessError } from '@/lib/excess/server'

// E-signing by voice: where a job's signing requests are up to, sending the
// Scope of Works Authorisation / Building Contract for signature, and
// resending a link. The same functions and defaults as the job's
// Send for Signature dialog (lib/signing/service.ts).
//
// The app allows several requests per job, so a second request for the same
// document while one is still open is refused unless the user confirms it —
// otherwise a repeated voice request would email the homeowner twice (and
// could raise a second excess invoice).

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/
const OPEN_STATUSES = ['sent', 'viewed']
const DOCUMENT_TYPES = Object.keys(SIGNING_DOCUMENT_CATALOG) as SigningDocumentTypeKey[]

const actorFor = (ctx: McpContext): SigningActor => ({ tenantId: ctx.tenantId, userId: ctx.userId })

function errorResult(err: unknown): McpToolResult {
  if (err instanceof SigningError || err instanceof ExcessError) {
    return { text: err.message, data: { status: err.status }, isError: true }
  }
  throw err
}

/** "Building Contract to Jane Smith (jane@…): sent 10 Oct, viewed 11 Oct, expires 24 Oct." */
export function describeRequest(r: SigningRequestSummary): string {
  const who = `${r.signerName}${r.signerEmail ? ` (${r.signerEmail})` : ''}`
  const steps: string[] = []
  if (r.status === 'signed' && r.signedAt) steps.push(`signed ${spokenDate(r.signedAt)}`)
  else if (r.status === 'revoked') steps.push(`cancelled${r.revokedAt ? ` ${spokenDate(r.revokedAt)}` : ''}${r.revokedReason ? ` (${r.revokedReason})` : ''}`)
  else {
    if (r.sentAt) steps.push(`sent ${spokenDate(r.sentAt)}`)
    if (r.viewedAt) steps.push(`opened ${spokenDate(r.viewedAt)}`)
    if (r.reminderCount) steps.push(`${r.reminderCount} reminder${r.reminderCount === 1 ? '' : 's'}`)
    if (r.status === 'expired') steps.push('link expired')
    else if (r.expiresAt) steps.push(`link expires ${spokenDate(r.expiresAt)}`)
    if (!r.remindersEnabled) steps.push('reminders off')
  }
  return `${r.documentTitle} to ${who}: ${steps.join(', ') || r.status}.`
}

const requestData = (r: SigningRequestSummary) => ({
  request_id: r.id, document_type: r.documentType, document_title: r.documentTitle, status: r.status,
  signer_name: r.signerName, signer_email: r.signerEmail, sent_at: r.sentAt, viewed_at: r.viewedAt,
  signed_at: r.signedAt, expires_at: r.expiresAt, reminder_count: r.reminderCount,
  reminders_enabled: r.remindersEnabled, quote_ids: r.quoteIds,
})

/** What the excess question is, for Claude to ask before sending. */
function excessQuestion(d: SendDialogDefaults): string | null {
  const x = d.excess
  if (!x.applies) return null
  const options = [
    x.amount ? `create an excess invoice for ${money(x.amount)} and attach it` : 'create an excess invoice (ask the amount) and attach it',
    ...x.invoices.map(inv => `attach existing excess invoice ${inv.ref ?? ''} (${money(inv.amountIncGst)})`.replace('  ', ' ')),
    ...(x.invoices.length ? ['an excess invoice was already sent separately, so attach nothing'] : []),
    'confirm there is no excess',
    `not collecting it (${EXCESS_WAIVER_REASONS.map(r => r.label.toLowerCase()).join('; ')})`,
  ]
  return `Excess: ${describeExcess(x)} Before sending, ask which: ${options.join('; or ')}.`
}

export const getSigning: McpTool = {
  name: 'get_signing',
  title: 'Get signing status',
  description: [
    'Where a job\'s e-signing is up to — each signing request with its document, signer, and when it was sent, opened, signed or expired —',
    'and what a new Send for Signature would use: the approved quotes, the suggested document',
    '(Scope of Works Authorisation up to the threshold, Building Contract above it), the signer, and the excess question to ask.',
    'Use it to answer "have they signed?" and before send_for_signature.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { job_number: { type: 'string', description: 'Job number, e.g. IRC1001.' } },
    required: ['job_number'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const job = await jobFromArgs(args, ctx)
    if (isToolResult(job)) return job
    let requests: SigningRequestSummary[], defaults: SendDialogDefaults
    try {
      [requests, defaults] = await Promise.all([
        listSigningRequestsForJob(actorFor(ctx), job.id),
        getSendDialogDefaults(actorFor(ctx), job.id),
      ])
    } catch (err) {
      return errorResult(err)
    }

    const suggested = defaults.quotes.filter(q => defaults.suggestedQuoteIds.includes(q.id))
    const signer = defaults.signer
    const lines = [
      `${job.job_number}, ${job.property_address ?? 'no address'}.`,
      requests.length ? `Signing requests:\n${requests.map(r => `- ${describeRequest(r)}`).join('\n')}` : 'No signing requests yet.',
      suggested.length
        ? `A new request would send the ${signingDocumentLabel(defaults.suggestedDocumentType)} for ${suggested.map(q => `${q.ref ?? 'quote'} (${money(q.totalInclGst)})`).join(', ')}, total ${money(defaults.suggestedTotalInclGst)}.`
        : 'No approved quotes, so there is nothing to send for signature yet.',
      `Signer: ${signer.name || 'no name'}, ${signer.email || 'no email'}${defaults.signerSource ? ` (the ${defaults.signerSource})` : ''}.`,
      ...(defaults.jobStage === 'approved_awaiting_signoff' ? ['Sending moves the job to Awaiting Signed Document.'] : []),
      excessQuestion(defaults) ?? '',
    ].filter(Boolean)

    return {
      text: lines.join('\n'),
      data: {
        job_number: job.job_number,
        requests: requests.map(requestData),
        new_request: {
          quotes: defaults.quotes.map(q => ({ quote_id: q.id, ref: q.ref, status: q.status, total_incl_gst: q.totalInclGst, signable: q.signable })),
          suggested_quote_ids: defaults.suggestedQuoteIds,
          suggested_document_type: defaults.suggestedDocumentType,
          document_types: DOCUMENT_TYPES.map(k => ({ key: k, label: SIGNING_DOCUMENT_CATALOG[k].label, description: SIGNING_DOCUMENT_CATALOG[k].description })),
          signer,
          job_stage: defaults.jobStage,
          excess: defaults.excess,
        },
      },
    }
  },
}

export const sendForSignatureTool: McpTool = {
  name: 'send_for_signature',
  title: 'Send for signature',
  description: [
    'Emails the homeowner a link to sign the Scope of Works Authorisation or Building Contract for approved quotes (with a PDF copy of the document attached as a backup), exactly like Send for Signature in the app.',
    'Leave out quote_ids, document_type and the signer to use the suggestions from get_signing.',
    'Insurance jobs need an excess choice — ask the user using the options get_signing lists, then pass excess as one of:',
    '{"kind":"new_invoice","amountIncGst":500} (creates and attaches an excess invoice), {"kind":"attach_existing","invoiceId":"…"},',
    '{"kind":"existing_not_attached"}, {"kind":"no_excess"}, or {"kind":"not_collecting","reason":"cash_settlement|insurer_waived|already_paid|other","note":"…"}.',
    'ONLY call this after get_signing, once you have read back the document, quotes and total, the signer\'s name and email, and the excess choice, and the user has clearly said yes.',
    'If the same document is already out for signature it is refused; offer resend_signing_request, or pass send_anyway: true only if the user wants a second request.',
    'If a call returns an error, tell the user what it says instead of retrying.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      job_number: { type: 'string', description: 'Job number, e.g. IRC1001.' },
      document_type: { type: 'string', enum: DOCUMENT_TYPES, description: 'Leave out for the suggested type.' },
      quote_ids: { type: 'array', items: { type: 'string' }, description: 'quote_id values from get_signing. Leave out for the suggested (approved) quotes.' },
      signer_name: { type: 'string' },
      signer_email: { type: 'string' },
      signer_phone: { type: 'string' },
      excess: { type: 'object', description: 'Required for insurance jobs — see the description for the shapes.' },
      reminders: { type: 'boolean', description: 'Automatic reminders every 7 days (max 3). Default true.' },
      move_job_to_awaiting_stage: { type: 'boolean', description: 'Only applies when the job is at Approved – Awaiting Sign-off; default true there.' },
      send_anyway: { type: 'boolean', description: 'The user confirmed sending a second request while one for the same document is still open.' },
    },
    required: ['job_number'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },

  async run(args, ctx): Promise<McpToolResult> {
    const job = await jobFromArgs(args, ctx)
    if (isToolResult(job)) return job
    const actor = actorFor(ctx)
    const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string).trim() : '')

    try {
      const [defaults, requests] = await Promise.all([
        getSendDialogDefaults(actor, job.id),
        listSigningRequestsForJob(actor, job.id),
      ])

      const quoteIds = Array.isArray(args.quote_ids) && args.quote_ids.length
        ? args.quote_ids.filter((id): id is string => typeof id === 'string')
        : defaults.suggestedQuoteIds
      const unknown = quoteIds.filter(id => !defaults.quotes.some(q => q.id === id))
      if (unknown.length) return { text: 'Those quotes aren\'t on this job — use get_signing for the quote ids.', isError: true }
      if (!quoteIds.length) return { text: `${job.job_number} has no approved quotes to send for signature.`, isError: true }

      const total = defaults.quotes.filter(q => quoteIds.includes(q.id)).reduce((s, q) => s + q.totalInclGst, 0)
      const documentType = DOCUMENT_TYPES.find(k => k === args.document_type) ?? suggestDocumentType(total)
      const signer = {
        name: str('signer_name') || defaults.signer.name.trim(),
        email: str('signer_email') || defaults.signer.email.trim(),
        phone: str('signer_phone') || defaults.signer.phone.trim() || null,
      }
      if (signer.name.length < 2) return { text: 'Who should sign? There is no signer name on the job.', isError: true }
      if (!EMAIL_RE.test(signer.email)) return { text: `What email should the signing link go to? ${signer.email ? `"${signer.email}" isn't valid.` : 'There is none on the job.'}`, isError: true }

      const excess = defaults.excess.applies ? parseExcessChoice(args.excess) : null
      if (defaults.excess.applies && !excess) {
        return { text: excessQuestion(defaults) ?? 'Choose what to do about the excess.', isError: true }
      }

      const open = requests.filter(r => r.documentType === documentType && OPEN_STATUSES.includes(r.status))
      if (open.length && args.send_anyway !== true) {
        return {
          text: `Not sent: ${open.map(describeRequest).join(' ')} Offer to resend that link instead (resend_signing_request), or send a second request only if the user confirms.`,
          data: { open_requests: open.map(requestData) },
          isError: true,
        }
      }

      const moveStage = defaults.jobStage === 'approved_awaiting_signoff' && args.move_job_to_awaiting_stage !== false
      const result = await sendForSignature(
        actor,
        { jobId: job.id, documentType, quoteIds, signer, remindersEnabled: args.reminders !== false },
        { moveJobToAwaitingStage: moveStage, excess },
      )
      return {
        text: `${SIGNING_DOCUMENT_CATALOG[documentType].label}${result.excessInvoiceRef ? ` and excess invoice ${result.excessInvoiceRef}` : ''} emailed to ${result.request.signerEmail} for ${job.job_number}.`
          + (result.stageMoved ? ' Job moved to Awaiting Signed Document.' : ''),
        data: { request: requestData(result.request), stage_moved: result.stageMoved, excess_invoice_ref: result.excessInvoiceRef },
      }
    } catch (err) {
      return errorResult(err)
    }
  },
}

export const resendSigningRequestTool: McpTool = {
  name: 'resend_signing_request',
  title: 'Resend signing link',
  description: [
    'Emails the signer a fresh link for an existing signing request (the previous link stops working), with the document PDF attached and the excess invoice attached again if one went originally — like Resend in the app.',
    'Use the request_id from get_signing. Read back the document and signer and get a clear yes first.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { request_id: { type: 'string', description: 'request_id from get_signing.' } },
    required: ['request_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },

  async run(args, ctx): Promise<McpToolResult> {
    const id = typeof args.request_id === 'string' ? args.request_id.trim() : ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { text: 'Signing request not found — use get_signing for its id.', isError: true }
    try {
      const r = await resendSigningRequest(actorFor(ctx), id)
      return { text: `Sent ${r.signerName} a fresh link for the ${r.documentTitle}. ${describeRequest(r)}`, data: requestData(r) }
    } catch (err) {
      return errorResult(err)
    }
  },
}
