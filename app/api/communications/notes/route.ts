import { NextRequest, NextResponse } from 'next/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { permissionDenied } from '@/lib/permissions/http'
import { createServiceClient } from '@/lib/supabase/server'
import { recordActivity } from '@/lib/activity/log'
import { JobNoteError, addJobNote } from '@/lib/communications/notes'

// POST { job_id, note } — the Comms feed's "Add note" box.
export async function POST(req: NextRequest) {
  const me = await sessionUser()
  if (!me) return unauthorized()

  const body = await req.json().catch(() => null) as { job_id?: unknown; note?: unknown } | null
  const jobId = typeof body?.job_id === 'string' ? body.job_id : ''
  if (!jobId) return NextResponse.json({ error: 'job_id is required' }, { status: 400 })

  const denied = await permissionDenied(me.tenantId, me.userId, 'jobs.notes')
  if (denied) return denied

  const service = createServiceClient()
  try {
    const note = await addJobNote(service, { tenantId: me.tenantId, userId: me.userId, jobId, note: body?.note, source: 'app' })
    await recordActivity({
      tenantId: me.tenantId, userId: me.userId, action: 'jobs.notes', jobId, via: 'app', service,
      summary: 'Added a job note', detail: note.content,
    })
    return NextResponse.json(note)
  } catch (err) {
    if (err instanceof JobNoteError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('[communications/notes] failed:', err)
    return NextResponse.json({ error: 'Couldn\'t save the note' }, { status: 500 })
  }
}
