import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/supabase/server'
import { listAutoActions } from '@/lib/automation/auto-bookings'

// GET — Done for you (tech spec §23.19): what IRC did by itself in the last two weeks. Read only.
export async function GET() {
  const me = await sessionUser()
  if (!me) return unauthorized()
  try {
    return NextResponse.json({ actions: await listAutoActions(createServiceClient() as unknown as SupabaseClient, me.tenantId) })
  } catch (err) {
    console.error('[auto-actions] failed:', err)
    return NextResponse.json({ error: 'Couldn\'t load what was done for you' }, { status: 500 })
  }
}
