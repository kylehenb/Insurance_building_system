import { NextRequest, NextResponse } from 'next/server'
import { isUuid, signingActorFromSession, signingErrorResponse, unauthorized } from '@/lib/signing/http'
import { getSigningProvider, listSigningEvents } from '@/lib/signing/service'

// GET → one request's status and its audit trail
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Signing request not found' }, { status: 404 })
  const actor = await signingActorFromSession()
  if (!actor) return unauthorized()

  try {
    const [request, events] = await Promise.all([
      getSigningProvider().getStatus(actor, id),
      listSigningEvents(actor, id),
    ])
    return NextResponse.json({ request, events })
  } catch (err) {
    return signingErrorResponse(err, 'load signing request')
  }
}
