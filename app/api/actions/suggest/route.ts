import { NextRequest, NextResponse } from 'next/server'
import { cardAccess, isUuid } from '@/lib/actions/access'
import { CardError, withContext } from '@/lib/actions/cards'
import { resuggestCard, resuggestStep } from '@/lib/actions/propose'
import { mailDb } from '@/lib/mail/sync'

export const maxDuration = 120

const MAX_FEEDBACK = 2000

// POST /api/actions/suggest { threadId | cardId, feedback? } — make (or
// remake) the card for a conversation (or a follow-up card, by cardId) now: "Suggest next steps", "Try again" and
// "Re-suggest" on the page. feedback: what the office wants instead ("Tell the
// AI what to change"), followed over the AI's own view. With cardId and
// stepId, feedback changes just that step and the rest of the card stays.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const access = await cardAccess(true)
  if (access instanceof NextResponse) return access
  let body: { threadId?: unknown; cardId?: unknown; stepId?: unknown; feedback?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const threadId = typeof body.threadId === 'string' && /^[0-9a-f]+$/i.test(body.threadId) ? body.threadId : null
  const cardId = isUuid(body.cardId) ? body.cardId : null
  if (!threadId && !cardId) return NextResponse.json({ error: 'threadId or cardId is required' }, { status: 400 })
  const stepId = cardId && isUuid(body.stepId) ? body.stepId : null
  const feedback = typeof body.feedback === 'string' ? body.feedback.trim().slice(0, MAX_FEEDBACK) : ''
  if (stepId && !feedback) return NextResponse.json({ error: 'Say what this step should do instead' }, { status: 400 })
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'The AI isn\'t set up (no API key)' }, { status: 503 })

  try {
    const db = mailDb()
    const card = stepId
      ? await resuggestStep(db, access.tenantId, cardId!, stepId, feedback, access.userId)
      : await resuggestCard(db, access.tenantId, cardId ? { cardId } : { threadId: threadId! }, feedback, access.userId)
    if (!card && !cardId) return NextResponse.json({ error: 'Could not queue the card' }, { status: 502 })
    return NextResponse.json({ card: card ? (await withContext(db, access.tenantId, [card]))[0] : null })
  } catch (err) {
    if (err instanceof CardError) return NextResponse.json({ error: err.status === 409 && !stepId ? 'That card can\'t be re-suggested now' : err.message }, { status: err.status })
    throw err
  }
}
