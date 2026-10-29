import { NextRequest, NextResponse } from 'next/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { recordOperation } from '@/lib/activity/log'
import { OPERATIONS } from '@/lib/approvals/operations'
import { permissionDenied } from '@/lib/permissions/http'
import { createServiceClient } from '@/lib/supabase/server'

type Params = { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/learning/lessons/[id] { active } — turn one of the AI's lessons
// off (it stops being used) or back on. Permission settings.edit; logged.
export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid lesson' }, { status: 400 })
  const body = await req.json().catch(() => ({})) as { active?: unknown }
  if (typeof body.active !== 'boolean') return NextResponse.json({ error: 'Say whether the lesson is on or off' }, { status: 400 })
  const denied = await permissionDenied(me.tenantId, me.userId, 'settings.edit')
  if (denied) return denied

  const service = createServiceClient()
  const payload = { lessonId: id, active: body.active }
  try {
    await OPERATIONS['lesson.status'].run(payload, { service, tenantId: me.tenantId, requesterId: me.userId })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not change the lesson' }, { status: 404 })
  }
  await recordOperation({ tenantId: me.tenantId, userId: me.userId, action: 'settings.edit', operation: 'lesson.status', payload, service })
  return NextResponse.json({ ok: true })
}
