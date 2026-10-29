import type { SupabaseClient } from '@supabase/supabase-js'

// An order email for a claim that already has an order (saved as source
// 'order_update' by lib/email/order-writer.ts saveOrderUpdate). Insurers often
// send new instructions — an extra trade, more scope — on a copy of the
// original order email, so the subject and most of the text match. The
// conversation's action card is given what's new compared with the original
// order, so it acts on the new instruction instead of calling it a re-send.

const MAX_LINES = 40

const normalise = (line: string) => line.replace(/\s+/g, ' ').trim().toLowerCase()

/** Lines of the new email that aren't in the original order email (quoted replies left out) */
export function newOrderLines(original: string | null, update: string | null): string[] {
  const seen = new Set((original ?? '').split(/\r?\n/).map(normalise).filter(Boolean))
  const lines: string[] = []
  for (const raw of (update ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (!line || line.startsWith('>') || seen.has(normalise(line))) continue
    // Where a reply's quoted history starts
    if (/^On .+ wrote:$/i.test(line)) break
    seen.add(normalise(line))
    lines.push(line)
    if (lines.length >= MAX_LINES) break
  }
  return lines
}

/**
 * For the action card of a conversation whose latest email is one of these:
 * what the card needs to know, or null when it isn't.
 */
export async function orderUpdateBrief(db: SupabaseClient, tenantId: string, threadId: string): Promise<string | null> {
  // Only while it's the latest email in: a later reply is the card's own business
  const { data: comms } = await db.from('communications')
    .select('source, body_text, job_id, insurer_order_id, created_at')
    .eq('tenant_id', tenantId).eq('thread_id', threadId).eq('direction', 'inbound')
    .order('created_at', { ascending: false }).limit(1)
  const update = (comms as { source: string | null; body_text: string | null; job_id: string | null; insurer_order_id: string | null }[] | null)?.[0]
  if (update?.source !== 'order_update') return null

  let orderQuery = db.from('insurer_orders').select('claim_number, raw_email_body, created_at, job_id').eq('tenant_id', tenantId)
  orderQuery = update.job_id ? orderQuery.eq('job_id', update.job_id) : orderQuery.eq('id', update.insurer_order_id ?? '')
  const { data: orders } = await orderQuery.order('created_at', { ascending: true }).limit(1)
  const original = (orders as { claim_number: string | null; raw_email_body: string | null; created_at: string; job_id: string | null }[] | null)?.[0]
  if (!original) return null

  let jobNumber: string | null = null
  if (original.job_id) {
    const { data: job } = await db.from('jobs').select('job_number').eq('tenant_id', tenantId).eq('id', original.job_id).maybeSingle()
    jobNumber = (job as { job_number: string } | null)?.job_number ?? null
  }
  const received = new Date(original.created_at).toLocaleDateString('en-AU', { timeZone: 'Australia/Perth', day: 'numeric', month: 'short', year: 'numeric' })
  const lines = newOrderLines(original.raw_email_body, update.body_text)
  return [
    'MORE ON A CLAIM THAT ALREADY HAS AN ORDER',
    `The latest email came in as an insurer order, but claim ${original.claim_number ?? '(no number)'} already has ${jobNumber ? `job ${jobNumber}` : 'an order waiting to be lodged'} from the order received ${received}.`,
    'Insurers often send new instructions on a copy of the original order email, so the subject and most of the text can match.',
    lines.length
      ? `Lines in this email that weren't in the original order:\n${lines.map(l => `  ${l}`).join('\n')}`
      : 'Its text is the same as the original order\'s — check the attachments before calling it a re-send.',
    'Act on anything new (an extra trade to allocate, more scope, a changed contact) as the instruction, with high priority. Call it a re-send only if nothing new is asked for. Don\'t propose create_order_from_email.',
  ].join('\n')
}

/** Of these conversations, the ones holding an order email on a claim that already had an order */
export async function orderUpdateThreads(db: SupabaseClient, tenantId: string, threadIds: string[]): Promise<Set<string>> {
  if (!threadIds.length) return new Set()
  const { data } = await db.from('communications').select('thread_id')
    .eq('tenant_id', tenantId).eq('source', 'order_update').in('thread_id', threadIds)
  return new Set(((data as { thread_id: string }[] | null) ?? []).map(r => r.thread_id))
}
