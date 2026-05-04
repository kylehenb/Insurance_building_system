import { createServiceClient } from '@/lib/supabase/server'
import type { ParsedOrderResult } from './order-parser'
import type { ExtractedMessage } from '@/lib/gmail/messages'

export async function writeInsurerOrder(
  parsed: ParsedOrderResult,
  message: ExtractedMessage,
  tenantId: string
): Promise<string> {
  const supabase = createServiceClient()

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
      raw_email_link: rawEmailLink,
      status: 'pending',
    })
    .select('id')
    .single()

  if (orderError || !order) {
    console.error('[order-writer] insert error:', orderError)
    throw new Error(`Failed to insert insurer_order: ${orderError?.message}`)
  }

  const orderId = order.id

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
