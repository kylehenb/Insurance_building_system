import { NextRequest, NextResponse } from 'next/server'
import { mailAccess } from '@/lib/mail/access'
import { createOrderFromEmail, OrderFromEmailError, orderForEmail } from '@/lib/insurer-orders/from-email'
import { mailDb } from '@/lib/mail/sync'
import { permissionDenied } from '@/lib/permissions/http'
import { recordActivity } from '@/lib/activity/log'

type Params = { params: Promise<{ threadId: string }> }

export const maxDuration = 120

// POST /api/mail/threads/[threadId]/order { messageId } — turn an insurer's
// order email the auto lodger missed into an order (not lodged yet). Returns
// { orderId, existing } — existing when the email already became one.
export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const access = await mailAccess()
  if (access instanceof NextResponse) return access
  const denied = await permissionDenied(access.tenantId, access.userId, 'orders.manage')
  if (denied) return denied

  const { threadId } = await params
  let body: { messageId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const messageId = typeof body.messageId === 'string' && /^[0-9a-f]+$/i.test(body.messageId) ? body.messageId : null
  if (!messageId || !/^[0-9a-f]+$/i.test(threadId)) return NextResponse.json({ error: 'Invalid email' }, { status: 400 })

  try {
    const existing = await orderForEmail(mailDb(), access.tenantId, messageId, threadId)
    if (existing) return NextResponse.json({ orderId: existing, existing: true })
    const { orderId, existing: claimHasOrder } = await createOrderFromEmail(access.tenantId, messageId, 'on the Mail page')
    if (claimHasOrder) return NextResponse.json({ orderId, existing: true })
    await recordActivity({ tenantId: access.tenantId, userId: access.userId, action: 'orders.manage', summary: 'Created an insurer order from an email on the Mail page', via: 'app' })
    return NextResponse.json({ orderId, existing: false })
  } catch (err) {
    if (err instanceof OrderFromEmailError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[mail] create order failed:', err)
    return NextResponse.json({ error: `Couldn't read that email into an order: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 })
  }
}
