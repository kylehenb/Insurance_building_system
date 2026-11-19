import { NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'
import { createServiceClient } from '@/lib/supabase/server'
import { loadOpenServices } from '@/lib/jobs/services'

// GET → every requested service still open across the office's jobs
// (lib/jobs/services.ts), make safes nobody's doing first — the dashboard's
// "Requested services" list. Midcity's field-app jobs are left out.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getUser()
  if (!user?.tenant_id || !user.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const services = await loadOpenServices(createServiceClient(), user.tenant_id)
    return NextResponse.json({ services })
  } catch (err) {
    console.error('[services] open list failed:', err)
    return NextResponse.json({ error: 'Failed to load the requested services' }, { status: 500 })
  }
}
