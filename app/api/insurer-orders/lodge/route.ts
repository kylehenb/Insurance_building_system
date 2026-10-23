import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/get-user'
import { LodgeError, lodgeInsurerOrder } from '@/lib/insurer-orders/lodge'
import { permissionDenied } from '@/lib/permissions/http'

// Lodge button: creates the job for an insurer order (see lib/insurer-orders/lodge.ts).
// Only the signed-in user's own tenant's orders can be lodged.
export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user?.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const denied = await permissionDenied(user.tenant_id, user.session?.user.id, 'orders.lodge')
  if (denied) return denied
  try {
    const { orderId } = await req.json()
    if (!orderId) {
      return NextResponse.json({ error: 'orderId required' }, { status: 400 })
    }
    return NextResponse.json(await lodgeInsurerOrder(createServiceClient(), orderId, { tenantId: user.tenant_id }))
  } catch (err) {
    if (err instanceof LodgeError) {
      return NextResponse.json({ error: err.message, ...err.details }, { status: err.status })
    }
    console.error('[lodge] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
