import { NextRequest, NextResponse } from 'next/server'
import { cardAccess, isUuid } from '@/lib/actions/access'
import { CardError, confirmCard, type StepChoice } from '@/lib/actions/confirm'
import { withContext } from '@/lib/actions/cards'
import { mailDb } from '@/lib/mail/sync'

export const maxDuration = 120

type Params = { params: Promise<{ id: string }> }

// POST /api/actions/[id]/confirm { steps: [{ id, args? }], only? } — run the
// chosen steps (args: the user's edits, e.g. the reply text). Each step goes
// through the user's own permissions and is logged. only: run just these and
// leave the rest on the card (Send in an email step's composer).
export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const access = await cardAccess(true)
  if (access instanceof NextResponse) return access
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid card' }, { status: 400 })
  let body: { steps?: unknown; only?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const choices: StepChoice[] = Array.isArray(body.steps)
    ? body.steps.filter((s): s is StepChoice => !!s && typeof s === 'object' && typeof (s as StepChoice).id === 'string')
    : []
  try {
    const card = await confirmCard(access.tenantId, access.userId, id, choices, { only: body.only === true })
    return NextResponse.json({ card: (await withContext(mailDb(), access.tenantId, [card]))[0] })
  } catch (err) {
    if (err instanceof CardError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[actions] confirm failed:', err)
    return NextResponse.json({ error: 'Could not run the steps' }, { status: 502 })
  }
}
