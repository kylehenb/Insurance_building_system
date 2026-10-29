import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { linkThreadToJob } from '@/lib/communications/thread-link'
import type { ParsedOrderResult } from './order-parser'
import type { ExtractedMessage } from '@/lib/gmail/messages'
import { resolveInsurerClient } from '@/lib/clients/resolve-insurer'
import { GEMINI_FLASH_MODEL } from '@/lib/ai/gemini'
import { orderSituation } from '@/lib/insurer-orders/learning'

export async function writeFallbackOrder(
  message: ExtractedMessage,
  tenantId: string
): Promise<void> {
  const supabase = createServiceClient()
  const rawEmailLink = `https://mail.google.com/mail/u/0/#inbox/${message.messageId}`
  const emailAttachments = message.attachments.map(a => ({
    filename: a.filename,
    mimeType: a.mimeType,
    size: a.size,
  }))
  const { error } = await supabase
    .from('insurer_orders')
    .insert({
      tenant_id: tenantId,
      parse_status: 'needs_review',
      entry_method: 'email',
      order_sender_email: message.fromEmail || null,
      order_sender_name: message.fromName || null,
      raw_email_subject: message.subject || null,
      raw_email_link: rawEmailLink,
      raw_email_body: message.bodyText || null,
      email_attachments: emailAttachments,
      status: 'pending',
    } as never)
  if (error) {
    console.error('[order-writer] fallback insert error:', error)
  }
}

export type WriteOrderResult =
  | { kind: 'created'; orderId: string }
  /** Gemini classified it as not a new work order (is_new_order: false) */
  | { kind: 'not_order' }
  /**
   * The claim number already has an order (lodged as jobId, or still waiting).
   * The email is more on that claim — often new instructions (an extra trade,
   * more scope) on a copy of the original order email — so callers save it
   * with saveOrderUpdate rather than dropping it.
   */
  | { kind: 'existing_claim'; orderId: string; jobId: string | null; claimNumber: string }

// 'not_order' and 'existing_claim' are intentional, not errors — callers must
// not write a fallback row for them. Throws only on genuine DB/IO errors so the
// caller's fallback path is not confused with the intentional ones.
export async function writeInsurerOrder(
  parsed: ParsedOrderResult,
  message: ExtractedMessage,
  tenantId: string
): Promise<WriteOrderResult> {
  const supabase = createServiceClient()

  // --- ai_audit row ----------------------------------------------------------
  // Written before the is_new_order gate so every Gemini call is logged,
  // including calls that are rejected. Wrapped in try-catch — a logging failure
  // must never block the main pipeline.
  let aiAuditId: string | null = null
  try {
    const confidenceLabel =
      parsed.confidence >= 0.85 ? 'high' : parsed.confidence >= 0.5 ? 'medium' : 'low'

    const { data: auditRow } = await supabase
      .from('ai_audit' as never)
      .insert({
        tenant_id: tenantId,
        prompt_key: 'email_order_parser',
        model: GEMINI_FLASH_MODEL,
        category: 'parsing',
        input_summary: `Email: "${message.subject}" from ${message.fromEmail}`,
        output_parsed: {
          is_new_order: parsed.isNewOrder,
          is_new_order_reasoning: parsed.isNewOrderReasoning,
          confidence: parsed.confidence,
          parse_status: parsed.parseStatus,
          claim_number: parsed.data.claim_number ?? null,
          insured_name: parsed.data.insured_name ?? null,
          property_address: parsed.data.property_address ?? null,
        },
        confidence: confidenceLabel,
        outcome: parsed.isNewOrder ? 'pending' : 'rejected',
      } as never)
      .select('id')
      .single()

    aiAuditId = (auditRow as { id: string } | null)?.id ?? null
  } catch (auditErr) {
    console.error('[order-writer] ai_audit insert error (non-fatal):', auditErr)
  }

  // --- is_new_order gate -----------------------------------------------------
  // Reject emails Gemini classified as not a new work order. These may have
  // matched a keyword or sender pattern but are replies, notifications, internal
  // emails, or other non-order correspondence. The ai_audit row above captures
  // the full decision trail for the AI Activity Dashboard.
  if (!parsed.isNewOrder) {
    console.log(
      `[order-writer] REJECTED (is_new_order=false)` +
      ` subject="${message.subject}"` +
      ` from=${message.fromEmail}` +
      ` reasoning="${parsed.isNewOrderReasoning ?? 'none'}"` +
      ` ai_audit_id=${aiAuditId}`
    )
    return { kind: 'not_order' }
  }

  // --- claim_number dedup (primary) ------------------------------------------
  // Prevents a second row for the same claim number within a tenant. The
  // email itself is still kept — see WriteOrderResult 'existing_claim'.
  if (parsed.data.claim_number) {
    const { data: existingOrder } = await supabase
      .from('insurer_orders')
      .select('id, job_id')
      .eq('tenant_id', tenantId)
      .eq('claim_number', parsed.data.claim_number)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (existingOrder) {
      console.log(`[order-writer] claim_number ${parsed.data.claim_number} already has order ${existingOrder.id}: saving as more on that claim`)
      return { kind: 'existing_claim', orderId: existingOrder.id, jobId: existingOrder.job_id, claimNumber: parsed.data.claim_number }
    }
  }

  // --- thread_id dedup (secondary, for null-claim_number emails) ---------------
  // When claim_number is null, the primary dedup is skipped — this is exactly
  // when false positives arrive (replies, empty-body emails). Use thread_id as
  // a secondary guard: if a communications row already links this Gmail thread
  // to an insurer_order, treat it as a duplicate and return the existing order id.
  // Only checked when thread_id is available and claim_number is missing.
  if (!parsed.data.claim_number && message.threadId) {
    const { data: existingComm } = await supabase
      .from('communications')
      .select('insurer_order_id' as never)
      .eq('tenant_id' as never, tenantId as never)
      .eq('thread_id' as never, message.threadId as never)
      .not('insurer_order_id' as never, 'is', null)
      .limit(1)
      .maybeSingle()

    const existingOrderId = (existingComm as { insurer_order_id: string } | null)?.insurer_order_id
    if (existingOrderId) {
      console.log(`[order-writer] thread_id ${message.threadId} already linked to insurer_order ${existingOrderId}, skipping insert`)
      return { kind: 'created', orderId: existingOrderId }
    }
  }

  // --- insurer → client ------------------------------------------------------
  // Link the order to the matching insurer client so the Insurer dropdown is
  // pre-selected. The parsed name is often worded differently to the client
  // record (e.g. "Castle Insurance Pty Ltd" vs "Castle"), so match loosely and
  // store the client's canonical name.
  const insurerFields: { client_id?: string; insurer?: string } = {}
  try {
    const client = await resolveInsurerClient(supabase, tenantId, {
      insurer: parsed.data.insurer ?? parsed.insurerDetected,
      fromEmail: message.fromEmail,
      fromName: message.fromName,
      subject: message.subject,
      body: message.bodyText,
    })
    if (client) {
      insurerFields.client_id = client.id
      insurerFields.insurer = client.name
    }
  } catch (err) {
    console.error('[order-writer] insurer resolution error (non-fatal):', err)
  }

  // --- insert ----------------------------------------------------------------
  const rawEmailLink =
    parsed.rawEmailLink ??
    `https://mail.google.com/mail/u/0/#inbox/${message.messageId}`

  const { data: order, error: orderError } = await supabase
    .from('insurer_orders')
    .insert({
      tenant_id: tenantId,
      ...parsed.data,
      ...insurerFields,
      entry_method: 'email',
      parse_status: parsed.parseStatus,
      raw_email_subject: message.subject || null,
      raw_email_link: rawEmailLink,
      raw_email_body: parsed.rawEmailBody,
      email_attachments: parsed.emailAttachments,
      gemini_output: (parsed.rawGeminiOutput ?? parsed.data) as never,
      // Who sent it, for learning from what the office corrects (lib/insurer-orders/learning.ts)
      situation: orderSituation({ fromEmail: message.fromEmail, fromName: message.fromName, subject: message.subject, insurer: insurerFields.insurer ?? parsed.data.insurer }),
      ai_audit_id: aiAuditId,
      status: 'pending',
    } as never)
    .select('id')
    .single()

  if (orderError || !order) {
    console.error('[order-writer] insert error:', orderError)
    throw new Error(`Failed to insert insurer_order: ${orderError?.message}`)
  }

  const orderId = (order as { id: string }).id

  // Link the order to the communications thread so subsequent replies in this
  // thread are appended as communications rather than triggering new order rows.
  const commInsert: Record<string, unknown> = {
    tenant_id: tenantId,
    job_id: null,
    type: 'email',
    direction: 'inbound',
    subject: message.subject,
    content: message.bodyText,
    created_at: message.receivedAt,
  }

  // These columns are added via migration; cast via unknown to bypass strict DB types
  const commExtra: Record<string, unknown> = {
    insurer_order_id: orderId,
    thread_id: message.threadId,
    from_email: message.fromEmail,
    to_email: message.to,
    body_text: message.bodyText,
    gmail_message_id: message.gmailMessageId || null,
    source: 'auto_parsed',
  }

  const { error: commError } = await supabase
    .from('communications')
    .insert({ ...commInsert, ...commExtra } as never)

  if (commError) {
    console.error('[order-writer] communications insert error:', commError)
  }

  return { kind: 'created', orderId }
}

/**
 * Keeps an order email for a claim that already has an order (writeInsurerOrder's
 * 'existing_claim'): on the job's comms log, or on the order while it waits to
 * be lodged, as source 'order_update'. That source tells the email's action
 * card to compare it with the original order (lib/actions/propose.ts) — new
 * instructions often arrive on a copy of the original email.
 */
export async function saveOrderUpdate(
  db: SupabaseClient,
  tenantId: string,
  message: ExtractedMessage,
  existing: { orderId: string; jobId: string | null },
  opts: { communicationId?: string; attachments?: unknown[] } = {},
): Promise<void> {
  const { error } = await db.from('communications').insert({
    ...(opts.communicationId ? { id: opts.communicationId } : {}),
    tenant_id: tenantId,
    job_id: existing.jobId,
    insurer_order_id: existing.jobId ? null : existing.orderId,
    type: 'email',
    direction: 'inbound',
    subject: message.subject,
    content: message.bodyText,
    created_at: message.receivedAt,
    thread_id: message.threadId,
    from_email: message.fromEmail,
    to_email: message.to,
    body_text: message.bodyText,
    gmail_message_id: message.gmailMessageId || null,
    source: 'order_update',
    ...(opts.attachments ? { attachments: opts.attachments } : {}),
  } as never)
  if (error) {
    console.error('[order-writer] order update insert error:', error)
    return
  }
  if (existing.jobId && message.threadId) await linkThreadToJob(db, tenantId, message.threadId, existing.jobId)
}
