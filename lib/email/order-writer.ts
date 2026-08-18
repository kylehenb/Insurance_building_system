import { createServiceClient } from '@/lib/supabase/server'
import type { ParsedOrderResult } from './order-parser'
import type { ExtractedMessage } from '@/lib/gmail/messages'

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

// Returns the new insurer_order UUID, or null when the Gemini classification
// determined this is not a new work order (is_new_order: false). Null is an
// intentional rejection, not an error — callers must not write a fallback row on null.
// Throws only on genuine DB/IO errors so the caller's fallback path is not confused
// with the intentional rejection path.
export async function writeInsurerOrder(
  parsed: ParsedOrderResult,
  message: ExtractedMessage,
  tenantId: string
): Promise<string | null> {
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
        model: 'gemini-2.5-flash',
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
    return null
  }

  // --- claim_number dedup (primary) ------------------------------------------
  // Prevents a second row for the same claim number within a tenant.
  if (parsed.data.claim_number) {
    const { data: existingOrder } = await supabase
      .from('insurer_orders')
      .select('id, status, created_at')
      .eq('tenant_id', tenantId)
      .eq('claim_number', parsed.data.claim_number)
      .limit(1)
      .maybeSingle()

    if (existingOrder) {
      console.log(`[order-writer] duplicate claim_number ${parsed.data.claim_number} detected, skipping insert`)
      return existingOrder.id
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
      return existingOrderId
    }
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
      entry_method: 'email',
      parse_status: parsed.parseStatus,
      raw_email_subject: message.subject || null,
      raw_email_link: rawEmailLink,
      raw_email_body: parsed.rawEmailBody,
      email_attachments: parsed.emailAttachments,
      gemini_output: (parsed.rawGeminiOutput ?? parsed.data) as never,
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
    source: 'auto_parsed',
  }

  const { error: commError } = await supabase
    .from('communications')
    .insert({ ...commInsert, ...commExtra } as never)

  if (commError) {
    console.error('[order-writer] communications insert error:', commError)
  }

  return orderId
}
