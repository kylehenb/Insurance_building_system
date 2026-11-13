import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { logError } from '@/lib/health/errors'
import { transcribeAudio } from '@/lib/audio/transcribe'

export const dynamic = 'force-dynamic'
// A few minutes of talking takes a few seconds to turn into text; allow for a slow one
export const maxDuration = 60

// One section of Bindi Co's voice notes (the field app's Record button): turned
// into text with each phrase's timing, and the audio kept in the private
// voice-notes bucket in case a section needs listening back to. Nothing is
// written to the job here: the field app adds the text to its notes and keeps
// the section's timing in its draft (lib/audio/voice-timeline.ts). Sending the
// same section again (a retry after a dropped connection) just transcribes it again.

const MAX_BYTES = 20 * 1024 * 1024
const BUCKET = 'voice-notes'

export async function POST(req: NextRequest) {
  const me = await sessionUser()
  if (!me) return unauthorized()

  const form = await req.formData()
  const inspectionId = form.get('inspectionId')
  const sectionId = form.get('sectionId')
  const audio = form.get('audio')
  if (typeof inspectionId !== 'string' || typeof sectionId !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(sectionId) || !(audio instanceof Blob)) {
    return NextResponse.json({ error: 'inspectionId, sectionId and audio are required' }, { status: 400 })
  }
  if (!audio.size) return NextResponse.json({ ok: true, text: '', parts: [], seconds: 0 })
  if (audio.size > MAX_BYTES) return NextResponse.json({ error: 'Recording too large' }, { status: 413 })

  const service = createServiceClient()
  const { data: insp } = await service.from('inspections').select('id, job_id').eq('id', inspectionId).eq('tenant_id', me.tenantId).maybeSingle()
  if (!insp) return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })

  const type = audio.type || 'audio/mp4'
  const ext = type.includes('webm') ? 'webm' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'm4a'
  const data = Buffer.from(await audio.arrayBuffer())

  // The audio is a backup: if it can't be kept (the bucket's migration not run yet), the text still comes back
  const path = `tenants/${me.tenantId}/inspections/${inspectionId}/voice/${sectionId}.${ext}`
  const { error: storeErr } = await service.storage.from(BUCKET).upload(path, data, { contentType: type, upsert: true })
  if (storeErr) void logError('midcity-voice-notes', storeErr, { tenantId: me.tenantId, jobId: insp.job_id, detail: { step: 'store audio' } })

  try {
    const { text, parts, seconds } = await transcribeAudio({ data, name: `${sectionId}.${ext}`, type }, { feature: 'midcity-voice-notes', tenantId: me.tenantId, jobId: insp.job_id })
    return NextResponse.json({ ok: true, text, parts, seconds })
  } catch (err) {
    void logError('midcity-voice-notes', err, { tenantId: me.tenantId, jobId: insp.job_id })
    return NextResponse.json({ error: 'Could not turn the recording into text' }, { status: 502 })
  }
}
