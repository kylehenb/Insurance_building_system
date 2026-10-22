import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { LodgeError, lodgeInsurerOrder } from '@/lib/insurer-orders/lodge'

// Lodge button: creates the job for an insurer order (see lib/insurer-orders/lodge.ts).
export async function POST(req: NextRequest) {
  try {
    const { orderId } = await req.json()
    if (!orderId) {
      return NextResponse.json({ error: 'orderId required' }, { status: 400 })
    }
    return NextResponse.json(await lodgeInsurerOrder(createServiceClient(), orderId))
  } catch (err) {
    if (err instanceof LodgeError) {
      return NextResponse.json({ error: err.message, ...err.details }, { status: err.status })
    }
    console.error('[lodge] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
