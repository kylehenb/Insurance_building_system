import { NextRequest, NextResponse } from 'next/server'
import { isUuid, signingActorFromSession, signingErrorResponse, unauthorized } from '@/lib/signing/http'
import { isSigningAction, runSigningAction, type SigningActionBody } from '@/lib/signing/actions'
import { permissionGate } from '@/lib/permissions/http'

// POST /api/signing/requests/[id]/send          send a draft
// POST /api/signing/requests/[id]/resend        email a fresh link (old link stops working; excess invoice re-attached)
// POST /api/signing/requests/[id]/revoke        { reason? } stop the link working
// POST /api/signing/requests/[id]/confirm-stage record the sign-off and move the job on
// POST /api/signing/requests/[id]/reminders     { enabled } automatic reminders on/off
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Signing request not found' }, { status: 404 })
  if (!isSigningAction(action)) return NextResponse.json({ error: 'Unknown action' }, { status: 404 })
  const actor = await signingActorFromSession()
  if (!actor) return unauthorized()
  const body = await req.json().catch(() => ({})) as SigningActionBody
  const gated = await permissionGate(actor.tenantId, actor.userId, action === 'confirm-stage' ? 'jobs.change_stage' : 'send.signing', {
    operation: 'signing.action', payload: { requestId: id, action, body: { reason: body.reason, enabled: body.enabled } },
  })
  if (gated) return gated
  try {
    return NextResponse.json(await runSigningAction(actor, id, action, body))
  } catch (err) {
    return signingErrorResponse(err, action.replace('-', ' '))
  }
}
