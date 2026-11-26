import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { permissionDenied } from '@/lib/permissions/http'
import { createServiceClient } from '@/lib/supabase/server'
import { rewordLesson } from '@/lib/learning/debrief'

type Params = { params: Promise<{ id: string }> }

// POST { lesson?, applies_when?, remove? } — the Got it list's Reword and
// Remove on a takeaway the office just taught (tech spec §24.8). Only taught
// lessons, with the same permission as teaching from a card (actions.review);
// learned ones are managed on the What the AI has learned page.
export async function POST(req: NextRequest, { params }: Params) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const denied = await permissionDenied(me.tenantId, me.userId, 'actions.review')
  if (denied) return denied
  const { id } = await params
  const body = await req.json().catch(() => null) as { lesson?: unknown; applies_when?: unknown; remove?: unknown } | null
  const db = createServiceClient() as unknown as SupabaseClient
  const { data } = await db.from('learning_lessons').select('id, source').eq('tenant_id', me.tenantId).eq('id', id).maybeSingle()
  if (!data || (data as { source: string }).source !== 'taught') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (body?.remove === true) {
    await db.from('learning_lessons').update({ status: 'retired', retired_reason: 'Removed by the office as soon as it was taught', updated_at: new Date().toISOString() }).eq('tenant_id', me.tenantId).eq('id', id)
    return NextResponse.json({ ok: true, removed: true })
  }
  const ok = await rewordLesson(db, me.tenantId, id, {
    lesson: typeof body?.lesson === 'string' ? body.lesson : undefined,
    applies_when: typeof body?.applies_when === 'string' ? body.applies_when : undefined,
  })
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
}
