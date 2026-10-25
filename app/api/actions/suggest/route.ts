import { NextRequest, NextResponse } from 'next/server'
import { cardAccess } from '@/lib/actions/access'
import { getCard, queueEmailCard, withContext, type ActionCard } from '@/lib/actions/cards'
import { generateCard } from '@/lib/actions/propose'
import { discardStepDrafts } from '@/lib/actions/steps'
import { mailDb } from '@/lib/mail/sync'

export const maxDuration = 120

const MAX_FEEDBACK = 2000

// POST /api/actions/suggest { threadId, feedback? } — make (or remake) the
// card for a conversation now: "Suggest next steps", "Try again" and
// "Re-suggest" on the page. feedback: what the office wants instead ("Tell the
// AI what to change"), followed over the AI's own view.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const access = await cardAccess(true)
  if (access instanceof NextResponse) return access
  let body: { threadId?: unknown; feedback?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const threadId = typeof body.threadId === 'string' && /^[0-9a-f]+$/i.test(body.threadId) ? body.threadId : null
  if (!threadId) return NextResponse.json({ error: 'threadId is required' }, { status: 400 })
  const feedback = typeof body.feedback === 'string' ? body.feedback.trim().slice(0, MAX_FEEDBACK) : ''
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'The AI isn\'t set up (no API key)' }, { status: 503 })

  const db = mailDb()
  // A fresh read even if it was made for this same email before
  const id = await queueEmailCard(db, access.tenantId, threadId, null)
  if (!id) return NextResponse.json({ error: 'Could not queue the card' }, { status: 502 })
  // Emails edited in the composer are replaced by the new suggestion
  const before = await getCard(db, access.tenantId, id)
  if (before) await discardStepDrafts(before, db)
  await db.from('action_queue').update({ status: 'queued', attempts: 0 }).eq('id', id).in('status', ['pending', 'failed', 'queued'])

  // Take this one if it's still queued; otherwise another run is making it
  const queued = await getCard(db, access.tenantId, id)
  if (queued?.status === 'queued') {
    const { data: won } = await db.from('action_queue').update({ status: 'generating', attempts: 1, updated_at: new Date().toISOString() })
      .eq('id', id).eq('status', 'queued').select('*').maybeSingle()
    if (won) await generateCard(won as ActionCard, { db, feedback })
  }
  const card = await getCard(db, access.tenantId, id)
  return NextResponse.json({ card: card ? (await withContext(db, access.tenantId, [card]))[0] : null })
}
