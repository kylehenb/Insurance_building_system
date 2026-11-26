import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { permissionDenied } from '@/lib/permissions/http'
import { createServiceClient } from '@/lib/supabase/server'
import { recordActivity } from '@/lib/activity/log'
import { AutoActionError, undoAutoAction } from '@/lib/automation/auto-bookings'

// POST { id, reason? } — undo something IRC did by itself (tech spec §23.19),
// the same undoAutoAction as undo_done_for_you by voice. jobs.edit (on/off).
export async function POST(req: NextRequest) {
  const me = await sessionUser()
  if (!me) return unauthorized()
  const body = await req.json().catch(() => null) as { id?: unknown; reason?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const denied = await permissionDenied(me.tenantId, me.userId, 'jobs.edit')
  if (denied) return denied
  const service = createServiceClient()
  try {
    const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 2000) : undefined
    const undone = await undoAutoAction(service as unknown as SupabaseClient, me.tenantId, id, me.userId, reason)
    await recordActivity({ tenantId: me.tenantId, userId: me.userId, action: 'jobs.edit', jobId: undone.job_id, via: 'app', service, summary: `Undid: ${undone.summary}`, detail: reason ?? null })
    return NextResponse.json(undone)
  } catch (err) {
    if (err instanceof AutoActionError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('[auto-actions/undo] failed:', err)
    return NextResponse.json({ error: 'Couldn\'t undo it' }, { status: 500 })
  }
}
