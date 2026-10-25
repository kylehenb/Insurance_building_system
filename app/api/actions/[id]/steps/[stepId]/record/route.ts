import { NextRequest, NextResponse } from 'next/server'
import { cardAccess, isUuid } from '@/lib/actions/access'
import { CardError } from '@/lib/actions/cards'
import { updateStepRecord } from '@/lib/actions/steps'

export const maxDuration = 60

type Params = { params: Promise<{ id: string; stepId: string }> }

// POST /api/actions/[id]/steps/[stepId]/record { values } — correct what a
// step acts on before it runs (the order before it's lodged). Runs the
// correcting tool as the user: its own permission, approval and log entry.
export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const access = await cardAccess(true)
  if (access instanceof NextResponse) return access
  const { id, stepId } = await params
  if (!isUuid(id) || !isUuid(stepId)) return NextResponse.json({ error: 'Invalid step' }, { status: 400 })
  let body: { values?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
    return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
  }
  try {
    const out = await updateStepRecord(access.tenantId, access.userId, id, stepId, body.values as Record<string, unknown>)
    return out.ok ? NextResponse.json({ message: out.text }) : NextResponse.json({ error: out.text }, { status: 400 })
  } catch (err) {
    if (err instanceof CardError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[actions] correcting a step\'s record failed:', err)
    return NextResponse.json({ error: 'Could not save the change' }, { status: 502 })
  }
}
