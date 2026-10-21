import { NextRequest, NextResponse } from 'next/server'
import { isUuid, signingActorFromSession, signingErrorResponse, unauthorized } from '@/lib/signing/http'
import { confirmSigningStage, getSigningProvider } from '@/lib/signing/service'

// POST /api/signing/requests/[id]/send          send a draft
// POST /api/signing/requests/[id]/resend        email a fresh link (old link stops working)
// POST /api/signing/requests/[id]/revoke        { reason? } stop the link working
// POST /api/signing/requests/[id]/confirm-stage record the sign-off and move the job on
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ACTIONS = ['send', 'resend', 'revoke', 'confirm-stage'] as const
type Action = (typeof ACTIONS)[number]

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Signing request not found' }, { status: 404 })
  if (!ACTIONS.includes(action as Action)) return NextResponse.json({ error: 'Unknown action' }, { status: 404 })
  const actor = await signingActorFromSession()
  if (!actor) return unauthorized()

  const provider = getSigningProvider()
  try {
    switch (action as Action) {
      case 'send':
        return NextResponse.json({ request: await provider.send(actor, id) })
      case 'resend':
        return NextResponse.json({ request: await provider.send(actor, id, { resend: true }) })
      case 'revoke': {
        const body = await req.json().catch(() => ({})) as { reason?: unknown }
        const reason = typeof body.reason === 'string' ? body.reason : null
        return NextResponse.json({ request: await provider.revoke(actor, id, reason) })
      }
      case 'confirm-stage':
        return NextResponse.json(await confirmSigningStage(actor, id))
    }
  } catch (err) {
    return signingErrorResponse(err, action.replace('-', ' '))
  }
}
