import { NextRequest, NextResponse } from 'next/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { permissionDenied } from '@/lib/permissions/http'
import { recordOperation } from '@/lib/activity/log'
import { decideSuggestion, SuggestionError, type Decision } from '@/lib/health/suggestions'
import { healthDb } from '@/lib/health/db'

type Params = { params: Promise<{ id: string }> }

const DECISIONS: Decision[] = ['accepted', 'dismissed', 'done', 'open']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/health/suggestions/[id] { decision: accepted | dismissed | done | open, note? }
// Accept, dismiss (with an optional reason), mark done or reopen a change the
// health review suggested (tech spec §25.5). Needs health.view. Recorded in
// the learning module and the who-did-what log.
export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const user = await sessionUser()
  if (!user) return unauthorized()
  const denied = await permissionDenied(user.tenantId, user.userId, 'health.view')
  if (denied) return denied

  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid suggestion' }, { status: 400 })
  let body: { decision?: unknown; note?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const decision = body.decision as Decision
  if (!DECISIONS.includes(decision)) return NextResponse.json({ error: 'decision must be accepted, dismissed, done or open' }, { status: 400 })
  const note = typeof body.note === 'string' ? body.note : null

  const db = healthDb()
  if (!db) return NextResponse.json({ error: 'No database configured' }, { status: 500 })
  try {
    const suggestion = await decideSuggestion(db, user.tenantId, id, decision, { userId: user.userId, note })
    await recordOperation({ tenantId: user.tenantId, userId: user.userId, action: 'health.view', operation: 'health.suggestion', payload: { id, decision, note } })
    return NextResponse.json({ suggestion })
  } catch (err) {
    if (err instanceof SuggestionError) return NextResponse.json({ error: err.message }, { status: 404 })
    throw err
  }
}
