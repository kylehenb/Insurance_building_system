import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/get-user'
import { LodgeError, lodgeInsurerOrder } from '@/lib/insurer-orders/lodge'
import { permissionGate } from '@/lib/permissions/http'
import { recordOperation } from '@/lib/activity/log'

// Lodge button: creates the job for an insurer order (see lib/insurer-orders/lodge.ts).
// Only the signed-in user's own tenant's orders can be lodged. skipAcknowledgement
// ("Lodge without acknowledgement") lodges without emailing the order's sender.
export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user?.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { orderId, skipAcknowledgement } = await req.json()
    if (!orderId) {
      return NextResponse.json({ error: 'orderId required' }, { status: 400 })
    }
    const userId = user.session?.user.id ?? null
    const payload = skipAcknowledgement === true ? { orderId, skipAcknowledgement: true } : { orderId }
    const gated = await permissionGate(user.tenant_id, userId, 'orders.lodge', { operation: 'order.lodge', payload })
    if (gated) return gated
    const result = await lodgeInsurerOrder(createServiceClient(), orderId, { tenantId: user.tenant_id, userId, skipAcknowledgement: payload.skipAcknowledgement === true })
    await recordOperation({ tenantId: user.tenant_id, userId, action: 'orders.lodge', operation: 'order.lodge', payload })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof LodgeError) {
      return NextResponse.json({ error: err.message, ...err.details }, { status: err.status })
    }
    console.error('[lodge] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
