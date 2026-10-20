import { createServiceClient } from '@/lib/supabase/server'
import { getGmailClient } from '@/lib/gmail/client'
import { buildEmailRaw } from '@/lib/email/build-raw'
import { renderTemplate, resolveEmailTemplate } from '@/lib/email/templates'
import { woIsSent } from '@/app/dashboard/jobs/[jobId]/work-orders/types'
import { buildWorkOrderPdf, tradeLabelFor, type WorkOrderPdfContext } from '@/lib/work-orders/work-order-pdf'

// Send & Lock: emails the work order PDF to the trade, then locks the work
// order (hands it to Gary). The draft is built from the tenant's
// 'work_order' email template so Auto send and Customise send start from the
// same content.

const FALLBACK_FROM = 'office@insurancerepairco.com.au'
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/

export class WorkOrderEmailError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 | 422 | 500 | 502) {
    super(message)
    this.name = 'WorkOrderEmailError'
  }
}

export interface WorkOrderEmailDraft {
  to: string
  cc: string
  subject: string
  body: string
  attachmentName: string
  tradeName: string | null
  templateName: string
  /** True when the tenant hasn't written a template yet */
  usingBuiltInTemplate: boolean
}

export interface WorkOrderEmailOverrides {
  to?: string
  cc?: string
  subject?: string
  body?: string
}

/** Splits a comma/semicolon separated address list and validates each one. */
export function parseAddressList(value: string | undefined | null): string[] {
  const list = (value ?? '').split(/[,;]/).map(s => s.trim()).filter(Boolean)
  const bad = list.find(e => !EMAIL_RE.test(e))
  if (bad) throw new WorkOrderEmailError(`"${bad}" is not a valid email address`, 400)
  return list
}

async function loadSendContext(workOrderId: string, ctx: WorkOrderPdfContext) {
  const { supabase, tenantId } = ctx
  const { data: wo } = await supabase
    .from('work_orders').select('*').eq('id', workOrderId).eq('tenant_id', tenantId).maybeSingle()
  if (!wo) throw new WorkOrderEmailError('Work order not found', 404)

  const [jobRes, tenantRes, tradeRes] = await Promise.all([
    supabase.from('jobs').select('*').eq('id', wo.job_id).eq('tenant_id', tenantId).maybeSingle(),
    supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle(),
    wo.trade_id
      ? supabase.from('trades').select('*').eq('id', wo.trade_id).eq('tenant_id', tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  if (!jobRes.data) throw new WorkOrderEmailError('Job not found', 404)
  if (!tenantRes.data) throw new WorkOrderEmailError('Tenant not found', 404)
  return { wo, job: jobRes.data, tenant: tenantRes.data, trade: tradeRes.data }
}

export async function buildWorkOrderEmailDraft(
  workOrderId: string,
  ctx: WorkOrderPdfContext,
): Promise<WorkOrderEmailDraft> {
  const { wo, job, tenant, trade } = await loadSendContext(workOrderId, ctx)
  const template = await resolveEmailTemplate(ctx.supabase, ctx.tenantId, 'work_order', job.client_id)

  const woRef = wo.work_order_ref || `WO-${wo.id.slice(0, 8).toUpperCase()}`
  const vars = {
    trade_name:       trade?.business_name ?? '',
    trade_contact:    trade?.primary_contact?.trim() || trade?.business_name || 'there',
    trade_type:       tradeLabelFor(wo, trade) || 'the',
    work_order_ref:   woRef,
    job_number:       job.job_number,
    claim_number:     job.claim_number,
    insured_name:     job.insured_name,
    property_address: job.property_address,
    company_name:     tenant.trading_name || tenant.name,
  }

  // Filename as it will be once sent (no DRAFT suffix)
  const filename = [woRef, trade?.business_name || vars.trade_type, (job.property_address ?? '').slice(0, 80)]
    .map(p => (p ?? '').normalize('NFKD').replace(/[^\w\s,.-]/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' - ')

  return {
    to: trade?.contact_email?.trim() ?? '',
    cc: '',
    subject: renderTemplate(template.subject, vars),
    body: renderTemplate(template.body, vars),
    attachmentName: `${filename}.pdf`,
    tradeName: trade?.business_name ?? null,
    templateName: template.name,
    usingBuiltInTemplate: template.templateId === null,
  }
}

/**
 * Sends the work order to the trade and locks it. Overrides come from
 * Customise send; Auto send passes none and uses the template draft as-is.
 * The work order is only locked once Gmail has accepted the email.
 */
export async function sendWorkOrderEmail(
  workOrderId: string,
  ctx: WorkOrderPdfContext,
  overrides: WorkOrderEmailOverrides = {},
): Promise<{ communicationId: string | null }> {
  const { supabase, tenantId } = ctx
  const { wo, tenant } = await loadSendContext(workOrderId, ctx)
  if (woIsSent(wo)) throw new WorkOrderEmailError('This work order has already been sent', 409)

  const draft = await buildWorkOrderEmailDraft(workOrderId, ctx)
  const to = parseAddressList(overrides.to ?? draft.to)
  const cc = parseAddressList(overrides.cc ?? draft.cc)
  const subject = (overrides.subject ?? draft.subject).trim()
  const body = overrides.body ?? draft.body
  if (to.length === 0) {
    throw new WorkOrderEmailError('The trade has no email address — add one to the trade or use Customise send', 422)
  }
  if (!subject) throw new WorkOrderEmailError('Subject is required', 400)

  const { pdf, filename } = await buildWorkOrderPdf(workOrderId, ctx, { asSent: true })

  const fromEmail = tenant.contact_email ?? FALLBACK_FROM
  const raw = buildEmailRaw({
    from: fromEmail,
    to: to.join(', '),
    cc: cc.length ? cc.join(', ') : undefined,
    subject,
    body,
    attachments: [{ filename, mimeType: 'application/pdf', content: pdf }],
  })

  let gmailId: string | null = null
  let threadId: string | null = null
  try {
    const res = await getGmailClient().users.messages.send({ userId: 'me', requestBody: { raw } })
    gmailId = res.data.id ?? null
    threadId = res.data.threadId ?? null
  } catch (err) {
    console.error(`[work-order-email] Gmail send failed for ${workOrderId}:`, err)
    throw new WorkOrderEmailError('Failed to send email — the work order has not been locked', 502)
  }

  const service = createServiceClient()

  // Mark the sent copy as processed so the Gmail SENT watch doesn't record it twice
  if (gmailId) {
    await service
      .from('processed_gmail_messages' as never)
      .upsert(
        { message_id: gmailId, processed_at: new Date().toISOString() } as never,
        { onConflict: 'message_id', ignoreDuplicates: true }
      )
  }

  // Lock — same state transition as the old lock-only button
  const newGaryState = wo.predecessor_work_order_id ? 'waiting_on_dependent' : 'waiting_reply'
  const { error: lockErr } = await supabase
    .from('work_orders')
    .update({ gary_state: newGaryState, status: 'engaged' })
    .eq('id', workOrderId)
    .eq('tenant_id', tenantId)
  if (lockErr) {
    console.error(`[work-order-email] lock failed after send for ${workOrderId}:`, lockErr)
    throw new WorkOrderEmailError('Email sent, but the work order could not be locked — please lock it manually', 500)
  }

  // Keep a copy of exactly what was sent on the comms record. Non-fatal: the
  // email has gone and the work order is locked either way.
  const communicationId = crypto.randomUUID()
  let attachments: { filename: string; storage_path: string | null; mime_type: string; size_bytes: number }[] = [
    { filename, storage_path: null, mime_type: 'application/pdf', size_bytes: pdf.length },
  ]
  const storagePath = `tenants/${tenantId}/comms/${communicationId}/${Date.now()}-${filename.replace(/[^\w.,\- ]/g, '_')}`
  const { error: uploadErr } = await service.storage
    .from('job-files')
    .upload(storagePath, pdf, { contentType: 'application/pdf' })
  if (uploadErr) console.error(`[work-order-email] PDF copy upload failed for ${workOrderId}:`, uploadErr)
  else attachments = [{ ...attachments[0], storage_path: storagePath }]

  const { error: commErr } = await service.from('communications').insert({
    id:            communicationId,
    tenant_id:     tenantId,
    job_id:        wo.job_id,
    work_order_id: workOrderId,
    type:          'email',
    direction:     'outbound',
    contact_type:  'trade',
    subject,
    content:       body,
    body_text:     body,
    from_email:    fromEmail,
    to_email:      [...to, ...cc].join(', '),
    thread_id:     threadId,
    attachments,
    source:        'work_order_send',
  })
  if (commErr) {
    console.error(`[work-order-email] communications insert failed for ${workOrderId}:`, commErr)
    return { communicationId: null }
  }
  return { communicationId }
}
