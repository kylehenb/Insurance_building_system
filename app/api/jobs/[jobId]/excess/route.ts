import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'
import { createServiceClient } from '@/lib/supabase/server'
import { EXCESS_WAIVER_REASONS, type ExcessDecision } from '@/lib/excess/decision'
import { ExcessError, loadExcessContext, recordExcessDecision } from '@/lib/excess/server'
import { permissionGate } from '@/lib/permissions/http'
import { recordOperation } from '@/lib/activity/log'

// GET  → the job's excess: amount, the office's decision, excess invoices
// POST → record a decision without sending anything
//        { decision: 'nil' | 'cash_settlement' | 'insurer_waived' | 'already_paid' | 'other', note? }
//        ('collect' is recorded by raising/sending an excess invoice.)
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SETTABLE: ExcessDecision[] = ['nil', ...EXCESS_WAIVER_REASONS.map(r => r.value)]

async function actor() {
  const user = await getUser()
  if (!user?.tenant_id || !user.user || !user.session) return null
  return { tenantId: user.tenant_id, userId: user.session.user.id }
}

function errorResponse(err: unknown, action: string) {
  if (err instanceof ExcessError) return NextResponse.json({ error: err.message }, { status: err.status })
  console.error(`[excess] ${action} failed:`, err)
  return NextResponse.json({ error: `Failed to ${action}` }, { status: 500 })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  if (!UUID_RE.test(jobId)) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  const a = await actor()
  if (!a) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await loadExcessContext(createServiceClient(), a.tenantId, jobId))
  } catch (err) {
    return errorResponse(err, 'load excess')
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  if (!UUID_RE.test(jobId)) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  const a = await actor()
  if (!a) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { decision?: unknown; note?: unknown }
  const decision = SETTABLE.find(d => d === body.decision)
  if (!decision) return NextResponse.json({ error: 'Choose a valid excess decision' }, { status: 400 })
  const note = typeof body.note === 'string' ? body.note.slice(0, 1000) : null

  try {
    const service = createServiceClient()
    await loadExcessContext(service, a.tenantId, jobId) // checks the job is this tenant's
    const gated = await permissionGate(a.tenantId, a.userId, 'excess.decide', { operation: 'excess.decide', payload: { jobId, decision, note } })
    if (gated) return gated
    await recordExcessDecision(service, { tenantId: a.tenantId, jobId, userId: a.userId, decision, note })
    await recordOperation({ tenantId: a.tenantId, userId: a.userId, action: 'excess.decide', operation: 'excess.decide', payload: { jobId, decision, note }, service })
    return NextResponse.json(await loadExcessContext(service, a.tenantId, jobId))
  } catch (err) {
    return errorResponse(err, 'save excess decision')
  }
}
