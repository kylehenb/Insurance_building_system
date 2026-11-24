import { NextRequest, NextResponse } from 'next/server'
import { sessionUser } from '@/lib/auth/session'
import { permissionDenied } from '@/lib/permissions/http'
import { recordActivity } from '@/lib/activity/log'
import { FieldJobCreateError } from '@/lib/jobs/field-job-create'
import { createJobFromWorkOrder } from '@/lib/jobs/field-work-order'
import { VOICE_KEY_PREFIX, findVoiceKey } from '@/lib/voice-keys/keys'
import { keyFromAuthorization } from '@/lib/mcp/auth'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// A builder's work order (PDF, or a photo of it) → a Bindi Co job.
// Sent by the field app's New screen (signed in), or by the iPhone Shortcut
// from the share sheet with "Authorization: Bearer irc_vk_…" — a personal key
// from Settings → Voice connector, acting as its owner with their permissions.
// The file is the form field "file" (or the whole request body). Answers
// { jobId, inspectionId, jobNumber, existing, url, details }; the Shortcut
// opens url.

export async function POST(req: NextRequest) {
  const service = createServiceClient()

  let me: { tenantId: string; userId: string; voiceKeyId?: string } | null = null
  const key = keyFromAuthorization(req.headers.get('authorization'))
  if (key.startsWith(VOICE_KEY_PREFIX)) {
    const found = await findVoiceKey(key, service)
    if (found) me = { tenantId: found.tenantId, userId: found.userId, voiceKeyId: found.id }
  } else {
    me = await sessionUser()
  }
  if (!me) return NextResponse.json({ error: 'Not signed in. In the Shortcut, check the key after "Bearer ".' }, { status: 401 })

  const denied = await permissionDenied(me.tenantId, me.userId, 'orders.lodge')
  if (denied) return denied

  const file = await fileFrom(req)
  if (!file) return NextResponse.json({ error: 'No work order received — share the PDF to the Shortcut' }, { status: 400 })

  try {
    const job = await createJobFromWorkOrder(service, { tenantId: me.tenantId, userId: me.userId, file })
    if (!job.existing) {
      await recordActivity({
        tenantId: me.tenantId,
        userId: me.userId,
        action: 'orders.lodge',
        summary: `Made Bindi Co job ${job.jobNumber} from a work order (${job.details.address})`,
        jobId: job.jobId,
        via: me.voiceKeyId ? 'voice' : 'app',
        voiceKeyId: me.voiceKeyId ?? null,
        service,
      })
    }
    const url = `${req.nextUrl.origin}/midcity/field/${job.inspectionId}`
    return NextResponse.json({ ...job, url })
  } catch (err) {
    if (err instanceof FieldJobCreateError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[midcity/work-order] error:', err)
    return NextResponse.json({ error: 'Could not make the job from this work order' }, { status: 500 })
  }
}

/** The work order: form field "file" (or any file field), or the raw body */
async function fileFrom(req: NextRequest): Promise<{ data: Uint8Array; mimeType: string; fileName?: string } | null> {
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData().catch(() => null)
    if (!form) return null
    const entry = form.get('file') ?? [...form.values()].find(v => typeof v !== 'string')
    if (!entry || typeof entry === 'string') return null
    return { data: new Uint8Array(await entry.arrayBuffer()), mimeType: entry.type, fileName: entry.name }
  }
  const data = new Uint8Array(await req.arrayBuffer())
  if (data.byteLength === 0) return null
  // A raw body from the Shortcut: tell a PDF by its first bytes when the type is vague
  const isPdf = data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46
  return { data, mimeType: isPdf ? 'application/pdf' : contentType.split(';')[0].trim() }
}
