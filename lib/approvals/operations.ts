import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { PermissionKey } from '@/lib/permissions/catalogue'
import { sendWorkOrderEmail, type WorkOrderEmailOverrides } from '@/lib/work-orders/work-order-email'
import { buildDocumentEmailDraft, markDocumentsSentWithoutEmail, sendDocumentEmail, type DocumentEmailOverrides } from '@/lib/documents/send/email'
import type { DocumentRef } from '@/lib/documents/send/documents'
import { sendForSignature } from '@/lib/signing/service'
import type { CreateSigningRequestInput } from '@/lib/signing/provider'
import { runSigningAction, type SigningAction, type SigningActionBody } from '@/lib/signing/actions'
import { signingDocumentLabel } from '@/lib/signing/documents/catalog'
import type { ExcessChoice, ExcessDecision } from '@/lib/excess/decision'
import { EXCESS_DECISION_LABELS } from '@/lib/excess/decision'
import { recordExcessDecision } from '@/lib/excess/server'
import { replyToEmail } from '@/lib/communications/reply'
import { lodgeInsurerOrder } from '@/lib/insurer-orders/lodge'
import { setJobStage } from '@/lib/jobs/set-stage'
import { STAGE_CONFIG } from '@/lib/jobs/stageConfig'
import { generateInvoice, type GenerateInvoiceInput } from '@/lib/invoices/generate'
import { voidInvoice } from '@/lib/invoices/void'
import { describeDraft, sendDraft } from '@/lib/mail/compose'
import { scheduleDraft } from '@/lib/mail/scheduled'
import { spokenSendAt } from '@/lib/mail/schedule-rules'
import { getMailbox } from '@/lib/mail/sync'
import { getLesson, setLessonActive } from '@/lib/learning/lessons'
import { setAutoConfirm } from '@/lib/learning/auto-confirm'

// What an approval request does once approved. Each operation calls the same
// shared function as the button (or voice tool) the request came from, so an
// approved action is exactly the action that was asked for. describe() gives
// the approver a plain-English summary when the request is made.

type Service = SupabaseClient<Database>

export interface OperationContext {
  service: Service
  tenantId: string
  /** Who asked — the action is done on their behalf (e.g. created_by) */
  requesterId: string | null
}

interface Operation<P> {
  describe(payload: P, ctx: OperationContext): Promise<{ summary: string; jobId: string | null }>
  /** Runs it; returns a short note of what happened */
  run(payload: P, ctx: OperationContext): Promise<string>
}

async function jobNumber(ctx: OperationContext, jobId: string | null): Promise<string> {
  if (!jobId) return 'no job'
  const { data } = await ctx.service.from('jobs').select('job_number').eq('tenant_id', ctx.tenantId).eq('id', jobId).maybeSingle()
  return data?.job_number ?? 'a job'
}

const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s)

// ── The operations ──────────────────────────────────────────────────────────

const workOrderSend: Operation<{ workOrderId: string; overrides: WorkOrderEmailOverrides }> = {
  async describe(p, ctx) {
    const { data: wo } = await ctx.service.from('work_orders').select('job_id, trade_name, trade_id').eq('tenant_id', ctx.tenantId).eq('id', p.workOrderId).maybeSingle()
    const { data: trade } = wo?.trade_id
      ? await ctx.service.from('trades').select('business_name, contact_email').eq('tenant_id', ctx.tenantId).eq('id', wo.trade_id).maybeSingle()
      : { data: null }
    const to = p.overrides.to || trade?.contact_email || 'no email on file'
    return {
      summary: `Send the ${wo?.trade_name ?? 'work order'}${trade?.business_name ? ` (${trade.business_name})` : ''} work order on ${await jobNumber(ctx, wo?.job_id ?? null)} to ${to}${p.overrides.body ? ', with changed wording' : ''}`,
      jobId: wo?.job_id ?? null,
    }
  },
  async run(p, ctx) {
    await sendWorkOrderEmail(p.workOrderId, { supabase: ctx.service, tenantId: ctx.tenantId }, p.overrides)
    return 'Work order sent.'
  },
}

const documentsSend: Operation<{ refs: DocumentRef[]; mode: 'auto' | 'custom' | 'mark_sent'; overrides: DocumentEmailOverrides }> = {
  async describe(p, ctx) {
    const draft = await buildDocumentEmailDraft(p.refs, { supabase: ctx.service, tenantId: ctx.tenantId })
    const titles = draft.attachments.map(a => a.title).join(', ')
    const jobId = p.refs[0]?.kind === 'photos' ? p.refs[0].id : await jobOfDocument(ctx, p.refs[0])
    return {
      summary: p.mode === 'mark_sent'
        ? `Mark ${titles} as sent on ${await jobNumber(ctx, jobId)} (not emailed)`
        : `Email ${titles} on ${await jobNumber(ctx, jobId)} to ${p.overrides.to || draft.to || 'no address on file'}${p.overrides.body ? ', with changed wording' : ''}`,
      jobId,
    }
  },
  async run(p, ctx) {
    const ectx = { supabase: ctx.service, tenantId: ctx.tenantId, actorId: ctx.requesterId }
    const result = p.mode === 'mark_sent'
      ? await markDocumentsSentWithoutEmail(p.refs, ectx)
      : await sendDocumentEmail(p.refs, ectx, p.overrides)
    const changes = result.statusChanges.map(c => c.description)
    return `${p.mode === 'mark_sent' ? 'Marked as sent.' : 'Emailed.'}${changes.length ? ` ${changes.join('. ')}.` : ''}`
  },
}

async function jobOfDocument(ctx: OperationContext, ref: DocumentRef | undefined): Promise<string | null> {
  if (!ref) return null
  const table = ref.kind === 'report' ? 'reports' : ref.kind === 'invoice' ? 'invoices' : 'quotes'
  const { data } = await ctx.service.from(table).select('job_id').eq('tenant_id', ctx.tenantId).eq('id', ref.id).maybeSingle()
  return data?.job_id ?? null
}

const signingCreate: Operation<{ input: CreateSigningRequestInput; options: { moveJobToAwaitingStage?: boolean; excess?: ExcessChoice | null } }> = {
  async describe(p, ctx) {
    return {
      summary: `Send the ${signingDocumentLabel(p.input.documentType)} on ${await jobNumber(ctx, p.input.jobId)} to ${p.input.signer.name} (${p.input.signer.email}) to sign${p.options.excess?.kind === 'new_invoice' ? `, with a new excess invoice for $${p.options.excess.amountIncGst}` : ''}`,
      jobId: p.input.jobId,
    }
  },
  async run(p, ctx) {
    const result = await sendForSignature({ tenantId: ctx.tenantId, userId: ctx.requesterId }, p.input, p.options)
    return `Sent to ${result.request.signerEmail}.${result.excessInvoiceRef ? ` Excess invoice ${result.excessInvoiceRef} attached.` : ''}`
  },
}

const SIGNING_ACTION_LABELS: Record<SigningAction, string> = {
  send: 'Send', resend: 'Resend a fresh link for', revoke: 'Cancel', 'confirm-stage': 'Confirm the sign-off for', reminders: 'Change reminders for',
}

const signingAction: Operation<{ requestId: string; action: SigningAction; body: SigningActionBody }> = {
  async describe(p, ctx) {
    const { data: r } = await ctx.service.from('signing_requests').select('job_id, signer_name, document_type').eq('tenant_id', ctx.tenantId).eq('id', p.requestId).maybeSingle()
    const what = r ? `the ${signingDocumentLabel(r.document_type)} signing request to ${r.signer_name}` : 'a signing request'
    const extra = p.action === 'reminders' ? ` (turn ${p.body.enabled ? 'on' : 'off'})` : p.action === 'revoke' && typeof p.body.reason === 'string' ? ` — "${clip(p.body.reason, 80)}"` : ''
    return { summary: `${SIGNING_ACTION_LABELS[p.action]} ${what} on ${await jobNumber(ctx, r?.job_id ?? null)}${extra}`, jobId: r?.job_id ?? null }
  },
  async run(p, ctx) {
    await runSigningAction({ tenantId: ctx.tenantId, userId: ctx.requesterId }, p.requestId, p.action, p.body)
    return 'Done.'
  },
}

const replySend: Operation<{ commId: string; body: string }> = {
  async describe(p, ctx) {
    const { data: c } = await ctx.service.from('communications').select('job_id, from_email, subject').eq('tenant_id', ctx.tenantId).eq('id', p.commId).maybeSingle()
    return {
      summary: `Reply to ${c?.from_email ?? 'an email'} about "${c?.subject ?? ''}" on ${await jobNumber(ctx, c?.job_id ?? null)}: "${clip(p.body)}"`,
      jobId: c?.job_id ?? null,
    }
  },
  async run(p, ctx) {
    const result = await replyToEmail(ctx.service, ctx.tenantId, p.commId, p.body)
    return `Replied to ${result.to}.`
  },
}

const orderLodge: Operation<{ orderId: string; skipAcknowledgement?: boolean }> = {
  async describe(p, ctx) {
    const { data: o } = await ctx.service.from('insurer_orders').select('claim_number, property_address, insured_name, insurer').eq('tenant_id', ctx.tenantId).eq('id', p.orderId).maybeSingle()
    return {
      summary: `Lodge the insurer order${o ? ` for ${[o.insurer, o.claim_number ? `claim ${o.claim_number}` : null, o.insured_name, o.property_address].filter(Boolean).join(', ')}` : ''} as a new job${p.skipAcknowledgement ? ', without emailing the sender an acknowledgement' : ''}`,
      jobId: null,
    }
  },
  async run(p, ctx) {
    const result = await lodgeInsurerOrder(ctx.service, p.orderId, { tenantId: ctx.tenantId, userId: ctx.requesterId, skipAcknowledgement: p.skipAcknowledgement === true })
    if (result.linkedToExisting) return `Linked to existing job ${result.jobNumber}.`
    return p.skipAcknowledgement ? `Lodged as ${result.jobNumber}, without an acknowledgement.` : `Lodged as ${result.jobNumber}.`
  },
}

const jobStage: Operation<{ jobId: string; stage: string }> = {
  async describe(p, ctx) {
    const label = (STAGE_CONFIG as Record<string, { label: string }>)[p.stage]?.label ?? p.stage
    return { summary: `Move ${await jobNumber(ctx, p.jobId)} to "${label}"`, jobId: p.jobId }
  },
  async run(p, ctx) {
    await setJobStage(ctx.service, ctx.tenantId, p.jobId, p.stage)
    return 'Stage changed.'
  },
}

const excessDecide: Operation<{ jobId: string; decision: ExcessDecision; note: string | null }> = {
  async describe(p, ctx) {
    return { summary: `Record the excess on ${await jobNumber(ctx, p.jobId)} as "${EXCESS_DECISION_LABELS[p.decision]}"${p.note ? ` — "${clip(p.note, 80)}"` : ''}`, jobId: p.jobId }
  },
  async run(p, ctx) {
    await recordExcessDecision(ctx.service, { tenantId: ctx.tenantId, jobId: p.jobId, userId: ctx.requesterId, decision: p.decision, note: p.note })
    return 'Excess decision recorded.'
  },
}

const INVOICE_TYPE_LABELS: Record<string, string> = {
  assessment: 'assessment report', make_safe: 'make safe', roof: 'roof report', leak_detection: 'leak detection report',
  excess: 'excess', balance: 'balance', quoted_amounts: 'quoted amounts', variations: 'variations', custom: 'custom',
}

const invoiceGenerate: Operation<{ input: GenerateInvoiceInput }> = {
  async describe(p, ctx) {
    const what = INVOICE_TYPE_LABELS[p.input.type] ?? p.input.type
    const amount = p.input.type === 'excess' && p.input.excessAmountIncGst ? ` for $${p.input.excessAmountIncGst}` : ''
    return { summary: `Create a ${what} invoice${amount} on ${await jobNumber(ctx, p.input.jobId)}`, jobId: p.input.jobId }
  },
  async run(p, ctx) {
    const { invoice } = await generateInvoice(ctx.service, ctx.tenantId, p.input)
    return `Created draft invoice ${invoice.invoice_ref ?? ''} for $${invoice.amount_inc_gst ?? 0}.`.replace('  ', ' ')
  },
}

const invoiceVoid: Operation<{ invoiceId: string; reason?: string | null }> = {
  async describe(p, ctx) {
    const { data } = await ctx.service.from('invoices').select('invoice_ref, amount_inc_gst, job_id').eq('tenant_id', ctx.tenantId).eq('id', p.invoiceId).maybeSingle()
    const reason = p.reason?.trim() ? ` — ${clip(p.reason.trim())}` : ''
    return { summary: `Void invoice ${data?.invoice_ref ?? ''} ($${data?.amount_inc_gst ?? 0}) on ${await jobNumber(ctx, data?.job_id ?? null)}${reason}`.replace('  ', ' '), jobId: data?.job_id ?? null }
  },
  async run(p, ctx) {
    const { invoice, warnings } = await voidInvoice(ctx.service, ctx.tenantId, p.invoiceId, { reason: p.reason, userId: ctx.requesterId })
    return [`Voided ${invoice.invoice_ref ?? 'the invoice'}.`, ...warnings].join(' ')
  },
}

/** A voice connector (or in-app assistant, via 'chat') tool call, replayed as the requester once approved */
const voiceTool: Operation<{ tool: string; args: Record<string, unknown>; via?: 'chat' }> = {
  async describe(p, ctx) {
    const { MCP_TOOLS } = await import('@/lib/mcp/tools')
    const tool = MCP_TOOLS.find(t => t.name === p.tool)
    const detail = await voiceDetail(p.tool, p.args, ctx)
    return { summary: `${tool?.title ?? p.tool} (${p.via === 'chat' ? 'by the assistant' : 'by voice'}): ${detail.text}`, jobId: detail.jobId }
  },
  async run(p, ctx) {
    const { MCP_TOOLS } = await import('@/lib/mcp/tools')
    const tool = MCP_TOOLS.find(t => t.name === p.tool)
    if (!tool) throw new Error(`Unknown voice tool ${p.tool}`)
    const out = await tool.run(p.args, { supabase: ctx.service, tenantId: ctx.tenantId, userId: ctx.requesterId ?? '', via: p.via })
    if (out.isError) throw new Error(out.text)
    return out.text
  },
}

// An email written on the Mail page; it waits in Gmail's drafts until approved
const mailSend: Operation<{ draftId: string }> = {
  async describe(p) {
    const { to, subject } = await describeDraft(p.draftId)
    return { summary: `Send the email "${clip(subject, 80)}" to ${clip(to, 120)} from the office mailbox`, jobId: null }
  },
  async run(p, ctx) {
    await sendDraft(await getMailbox(ctx.tenantId), p.draftId)
    return 'Email sent.'
  },
}

// Scheduling is sending later — approved, it goes on the schedule (or out at the next minute if the time has passed)
const mailSchedule: Operation<{ draftId: string; sendAt: string }> = {
  async describe(p) {
    const { to, subject } = await describeDraft(p.draftId)
    return { summary: `Send the email "${clip(subject, 80)}" to ${clip(to, 120)} from the office mailbox at ${spokenSendAt(p.sendAt)}`, jobId: null }
  },
  async run(p, ctx) {
    const mailbox = await getMailbox(ctx.tenantId)
    const late = new Date(p.sendAt).getTime() < Date.now() + 90_000
    if (late) {
      await sendDraft(mailbox, p.draftId)
      return 'The scheduled time had passed, so the email was sent now.'
    }
    await scheduleDraft(mailbox, ctx.requesterId, p.draftId, p.sendAt)
    return `Email scheduled for ${spokenSendAt(p.sendAt)}.`
  },
}

const FEATURE_NAMES: Record<string, string> = { action_card: 'action cards', report: 'reports' }

// A lesson the AI learned (tech spec §24), turned off or back on by a person
const lessonStatus: Operation<{ lessonId: string; active: boolean }> = {
  async describe(p, ctx) {
    const l = await getLesson(ctx.service, ctx.tenantId, p.lessonId)
    const what = l ? `"${clip(l.lesson, 100)}" (when: ${clip(l.applies_when, 80)}) for ${FEATURE_NAMES[l.feature] ?? l.feature}` : 'a lesson'
    return { summary: `${p.active ? 'Turn back on' : 'Turn off'} the AI's lesson ${what}`, jobId: null }
  },
  async run(p, ctx) {
    const { data: who } = ctx.requesterId
      ? await ctx.service.from('users').select('name').eq('tenant_id', ctx.tenantId).eq('id', ctx.requesterId).maybeSingle()
      : { data: null }
    const done = await setLessonActive(ctx.service, ctx.tenantId, p.lessonId, p.active, (who as { name: string | null } | null)?.name || 'someone in the office')
    if (!done) throw new Error('That lesson no longer exists')
    return p.active ? 'Lesson turned back on.' : 'Lesson turned off.'
  },
}

const KIND_NAMES: Record<string, string> = { invoice: 'Invoices to pay', attend_submit: 'Attend and Submit', other: 'Everything else' }

// Auto-confirm for a kind of AI proposal (tech spec §24.7): on, its proposals
// run without anyone confirming them, as the person who turned it on
const autoConfirmSet: Operation<{ feature: string; kind: string; enabled: boolean }> = {
  async describe(p) {
    const what = `${FEATURE_NAMES[p.feature] ?? p.feature} — ${KIND_NAMES[p.kind] ?? p.kind}`
    return { summary: `Turn auto-confirm ${p.enabled ? 'on' : 'off'} for ${what}`, jobId: null }
  },
  async run(p, ctx) {
    if (!ctx.requesterId) throw new Error('Auto-confirm needs someone to run as')
    await setAutoConfirm(ctx.service, ctx.tenantId, p.feature, p.kind, p.enabled, ctx.requesterId)
    return p.enabled ? 'Auto-confirm on.' : 'Auto-confirm off.'
  },
}

/** A readable description of a voice tool call, from the same lookups as the app's operations */
async function voiceDetail(tool: string, args: Record<string, unknown>, ctx: OperationContext): Promise<{ text: string; jobId: string | null }> {
  const str = (k: string) => (typeof args[k] === 'string' ? args[k] as string : undefined)
  // The job photos and files a send carries (the approver should see them)
  const listed = (k: string) => (Array.isArray(args[k]) ? (args[k] as unknown[]).map(v => (typeof v === 'string' ? v : JSON.stringify(v))) : [])
  const extras = [
    ...listed('attach_photos').map(p => `photo ${p}`), ...listed('attach_files'), ...(listed('attach_documents').length ? [`${listed('attach_documents').length} document PDF(s)`] : []),
  ]
  const withExtras = (summary: string) => (extras.length ? `${summary}, attaching ${clip(extras.join(', '), 120)}` : summary)
  try {
    if (tool === 'send_work_order' && str('work_order_id')) {
      const d = await workOrderSend.describe({ workOrderId: str('work_order_id')!, overrides: { to: str('to'), body: str('body') } }, ctx)
      return { text: d.summary, jobId: d.jobId }
    }
    if (tool === 'send_documents' && Array.isArray(args.documents)) {
      const d = await documentsSend.describe({ refs: args.documents as DocumentRef[], mode: 'custom', overrides: { to: str('to'), body: str('body') } }, ctx)
      return { text: withExtras(d.summary), jobId: d.jobId }
    }
    if (tool === 'reply_to_email' && str('email_id')) {
      const d = await replySend.describe({ commId: str('email_id')!, body: str('body') ?? '' }, ctx)
      return { text: withExtras(d.summary), jobId: d.jobId }
    }
    if (tool === 'lodge_order' && str('order_id')) {
      const d = await orderLodge.describe({ orderId: str('order_id')!, skipAcknowledgement: args.skip_acknowledgement === true }, ctx)
      return { text: d.summary, jobId: null }
    }
    if (tool === 'resend_signing_request' && str('request_id')) {
      const d = await signingAction.describe({ requestId: str('request_id')!, action: 'resend', body: {} }, ctx)
      return { text: d.summary, jobId: d.jobId }
    }
  } catch (err) {
    console.error(`[approvals] couldn't describe ${tool}:`, err)
  }
  const shown = Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${clip(typeof v === 'string' ? v : JSON.stringify(v), 80)}`)
    .join('; ')
  return { text: shown || 'no details', jobId: null }
}

export const OPERATIONS = {
  'work_order.send': workOrderSend,
  'documents.send': documentsSend,
  'signing.create': signingCreate,
  'signing.action': signingAction,
  'reply.send': replySend,
  'order.lodge': orderLodge,
  'job.stage': jobStage,
  'excess.decide': excessDecide,
  'invoice.generate': invoiceGenerate,
  'invoice.void': invoiceVoid,
  'mail.send': mailSend,
  'mail.schedule': mailSchedule,
  'lesson.status': lessonStatus,
  'auto_confirm.set': autoConfirmSet,
  'voice.tool': voiceTool,
} satisfies Record<string, Operation<never>>

export type OperationKey = keyof typeof OPERATIONS
export type OperationPayload<K extends OperationKey> = Parameters<typeof OPERATIONS[K]['run']>[0]

export function isOperation(value: string): value is OperationKey {
  return value in OPERATIONS
}

/** Which permission each app operation stands for (voice tools carry their own) */
export const OPERATION_ACTIONS: Record<Exclude<OperationKey, 'voice.tool'>, PermissionKey> = {
  'work_order.send': 'send.work_orders',
  'documents.send': 'send.documents',
  'signing.create': 'send.signing',
  'signing.action': 'send.signing',
  'reply.send': 'send.replies',
  'order.lodge': 'orders.lodge',
  'job.stage': 'jobs.change_stage',
  'excess.decide': 'excess.decide',
  'invoice.generate': 'invoices.manage',
  'invoice.void': 'invoices.manage',
  'mail.send': 'mail.send',
  'mail.schedule': 'mail.send',
  'lesson.status': 'settings.edit',
  'auto_confirm.set': 'settings.edit',
}
