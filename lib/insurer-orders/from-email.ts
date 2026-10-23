import type { SupabaseClient } from '@supabase/supabase-js'
import { extractMessageParts, getFullMessage } from '@/lib/gmail/messages'
import { parseInsurerOrder } from '@/lib/email/order-parser'
import { writeInsurerOrder } from '@/lib/email/order-writer'

// Turning an insurer's order email the auto job lodger missed into an order,
// with the lodger's own reader and writer. Used by the voice connector's
// create_order_from_email and the Mail page's "Create order" button.

const OWN_DOMAIN = 'insurancerepairco.com.au'

export class OrderFromEmailError extends Error {
  constructor(message: string, public readonly status: 400 | 422 = 422) {
    super(message)
    this.name = 'OrderFromEmailError'
  }
}

/** The order an email (or its conversation) already became, if any */
export async function orderForEmail(db: SupabaseClient, tenantId: string, messageId: string, threadId: string | null): Promise<string | null> {
  const { data: orders } = await db
    .from('insurer_orders').select('id')
    .eq('tenant_id', tenantId).like('raw_email_link', `%${messageId}%`).limit(1)
  const direct = (orders as { id: string }[] | null)?.[0]?.id
  if (direct) return direct
  if (!threadId) return null
  const { data: comms } = await db
    .from('communications').select('insurer_order_id')
    .eq('tenant_id', tenantId).eq('thread_id', threadId).not('insurer_order_id', 'is', null).limit(1)
  return (comms as { insurer_order_id: string }[] | null)?.[0]?.insurer_order_id ?? null
}

/**
 * Writes an order from the email. The user says it's an order, so it's
 * written even if the reader thought otherwise; `requestedBy` and the
 * reader's reasoning are kept on the audit record.
 */
export async function createOrderFromEmail(tenantId: string, messageId: string, requestedBy: string): Promise<string> {
  const msg = await extractMessageParts(await getFullMessage(messageId))
  if (msg.fromEmail.toLowerCase().endsWith(`@${OWN_DOMAIN}`)) {
    throw new OrderFromEmailError('That email is one of ours, not an insurer\'s order.', 400)
  }
  const parsed = await parseInsurerOrder(msg, null, tenantId)
  const orderId = await writeInsurerOrder(
    { ...parsed, isNewOrder: true, isNewOrderReasoning: `Created on request ${requestedBy}. Reader said: ${parsed.isNewOrderReasoning ?? 'no reason'}` },
    msg,
    tenantId,
  )
  if (!orderId) throw new OrderFromEmailError('The order could not be created. Enter it on the Insurer Orders page.')
  return orderId
}
