import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'
import { createServiceClient } from '@/lib/supabase/server'
import { permissionGate } from '@/lib/permissions/http'
import { recordOperation } from '@/lib/activity/log'
import { loadJobServices, parseServiceAction, runServiceAction, serviceActionJob, ServiceError } from '@/lib/jobs/services'

// A job's requested services (make safe, roof report, leak detection,
// specialist report — lib/jobs/services.ts).
// GET  → the services, open first, each with what it needs next
// POST → { action: 'in_house' | 'trade' | 'prepare' | 'not_needed' | 'add', serviceId?, tradeId?, cost?, reason?, type? }
//        Needs services.manage (or approval).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function actor() {
  const user = await getUser()
  if (!user?.tenant_id || !user.user || !user.session) return null
  return { tenantId: user.tenant_id, userId: user.session.user.id }
}

function errorResponse(err: unknown, what: string) {
  if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status })
  console.error(`[services] ${what} failed:`, err)
  return NextResponse.json({ error: `Failed to ${what}` }, { status: 500 })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  if (!UUID_RE.test(jobId)) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  const a = await actor()
  if (!a) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const includeClosed = req.nextUrl.searchParams.get('all') === '1'
    return NextResponse.json({ services: await loadJobServices(createServiceClient(), a.tenantId, jobId, { includeClosed }) })
  } catch (err) {
    return errorResponse(err, 'load the services')
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  if (!UUID_RE.test(jobId)) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  const a = await actor()
  if (!a) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  try {
    const action = parseServiceAction(body, jobId)
    const db = createServiceClient()
    // The service (or job) must be this tenant's, and on this job
    if (await serviceActionJob(db, a.tenantId, action) !== jobId) throw new ServiceError('Service not found', 404)
    const gated = await permissionGate(a.tenantId, a.userId, 'services.manage', { operation: 'service.arrange', payload: { action } })
    if (gated) return gated
    const result = await runServiceAction(db, a.tenantId, a.userId, action)
    await recordOperation({ tenantId: a.tenantId, userId: a.userId, action: 'services.manage', operation: 'service.arrange', payload: { action }, service: db })
    return NextResponse.json({ ...result, services: await loadJobServices(db, a.tenantId, jobId) })
  } catch (err) {
    return errorResponse(err, 'change the service')
  }
}
