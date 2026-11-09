import { NextRequest, NextResponse } from 'next/server'
import { cardAccess, isUuid } from '@/lib/actions/access'
import { CardError, isCategory, listCards, withContext } from '@/lib/actions/cards'
import { createFollowUp, spokenDue } from '@/lib/actions/followups'
import { recordActivity } from '@/lib/activity/log'
import { mailDb } from '@/lib/mail/sync'

// GET /api/followups[?job=] — follow-ups waiting for their date, soonest first.
// POST /api/followups { note, dueAt, who?, jobId?, threadId?, fromCardId?, clearCard? }
// — Remind me (lib/actions/followups.ts). On the day it becomes an action
// card with the chase drafted; nothing is sent by itself.
// POST /api/followups { todo: 'remind' | 'do', note, dueAt?, who?, jobId?, category?, urgent? }
// — + To-do: a to-do in the person's own words, now (no dueAt) or on a day;
// remind puts it on the list as it is, do has the AI draft the steps.

export async function GET(req: NextRequest): Promise<NextResponse> {
  const access = await cardAccess(false)
  if (access instanceof NextResponse) return access
  const job = req.nextUrl.searchParams.get('job')
  const db = mailDb()
  try {
    const cards = await listCards(db, access.tenantId, 'upcoming', { jobId: isUuid(job) ? job : null })
    return NextResponse.json({ followUps: await withContext(db, access.tenantId, cards) })
  } catch (err) {
    console.error('[followups] list failed:', err)
    return NextResponse.json({ error: 'Could not load follow-ups' }, { status: 502 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const access = await cardAccess(true)
  if (access instanceof NextResponse) return access
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const s = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '')
  const db = mailDb()
  try {
    let jobId = isUuid(body.jobId) ? body.jobId : null
    const fromCardId = isUuid(body.fromCardId) ? body.fromCardId : null
    // Set from a card: the card's job, unless one was given
    if (!jobId && fromCardId) {
      const { data } = await db.from('action_queue').select('job_id').eq('tenant_id', access.tenantId).eq('id', fromCardId).maybeSingle()
      jobId = (data as { job_id: string | null } | null)?.job_id ?? null
    }
    const mode = body.todo === 'remind' || body.todo === 'do' ? body.todo : null
    const card = await createFollowUp(db, access.tenantId, access.userId, {
      jobId, note: s('note'), who: s('who') || null, dueAt: s('dueAt'), threadId: s('threadId') || null,
      fromCardId, clearCard: body.clearCard === true,
      ...(mode ? { todo: { mode, category: isCategory(body.category) ? body.category : undefined }, urgent: body.urgent === true } : {}),
    })
    const when = card.status === 'scheduled' ? ` for ${spokenDue(card.due_at!)}` : ''
    await recordActivity({
      tenantId: access.tenantId,
      userId: access.userId,
      action: 'actions.review',
      summary: mode ? `Added a to-do${when}: ${card.title}` : `Set a follow-up${when}: ${card.follow_up?.note ?? card.title}`,
      jobId: card.job_id,
      via: 'app',
    })
    return NextResponse.json({ followUp: (await withContext(db, access.tenantId, [card]))[0] })
  } catch (err) {
    if (err instanceof CardError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[followups] create failed:', err)
    return NextResponse.json({ error: 'Could not set the follow-up' }, { status: 502 })
  }
}
