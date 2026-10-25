import { NextResponse } from 'next/server'
import { cardAccess, isUuid } from '@/lib/actions/access'
import { CardError } from '@/lib/actions/cards'
import { stepCompose } from '@/lib/actions/steps'
import { composeAccess, composeErrorResponse } from '@/lib/mail/access'

export const maxDuration = 60

type Params = { params: Promise<{ id: string; stepId: string }> }

// GET /api/actions/[id]/steps/[stepId]/compose — an email step, ready for the
// Mail page's composer: its saved draft, or the AI's email with the usual
// recipients, subject and quoted email (lib/actions/steps.ts)
export async function GET(_req: Request, { params }: Params): Promise<NextResponse> {
  const access = await cardAccess(true)
  if (access instanceof NextResponse) return access
  const writer = await composeAccess()
  if (writer instanceof NextResponse) return writer
  const { id, stepId } = await params
  if (!isUuid(id) || !isUuid(stepId)) return NextResponse.json({ error: 'Invalid step' }, { status: 400 })
  try {
    return NextResponse.json(await stepCompose(access.tenantId, id, stepId))
  } catch (err) {
    if (err instanceof CardError) return NextResponse.json({ error: err.message }, { status: err.status })
    return composeErrorResponse(err, 'open the email')
  }
}
