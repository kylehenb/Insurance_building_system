import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { AI_LABEL_BATCH_SIZE, labelPhotos, PhotoLabelError, type PhotoForLabelling } from '@/lib/photos/ai-label'

export const dynamic = 'force-dynamic'

const MAX_PHOTO_BASE64 = 2 * 1024 * 1024 // field app sends ~125 KB JPEGs; anything this big isn't one

// Labels one batch of field photos by looking at them. Body:
// { photos: [{ data: base64, mimeType }], context: notes + scope, jobContext }
// → { ok, labels: [{ kind, label, confidence } | null] } in the same order.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ inspectionId: string }> }
) {
  const { inspectionId } = await params
  const session = await sessionUser()
  if (!session) return unauthorized()

  const { photos, context, jobContext } = await req.json()
  const valid: PhotoForLabelling[] = Array.isArray(photos)
    ? photos.filter((p): p is PhotoForLabelling =>
        typeof p?.data === 'string' && p.data.length > 0 && p.data.length <= MAX_PHOTO_BASE64 &&
        typeof p?.mimeType === 'string' && p.mimeType.startsWith('image/'))
    : []
  if (!valid.length || valid.length !== photos.length) return NextResponse.json({ ok: false, labels: [], error: 'No usable photos sent' }, { status: 400 })
  if (valid.length > AI_LABEL_BATCH_SIZE) return NextResponse.json({ ok: false, labels: [], error: `Send at most ${AI_LABEL_BATCH_SIZE} photos at a time` }, { status: 400 })

  const service = createServiceClient()
  const { data: insp } = await service
    .from('inspections').select('id').eq('id', inspectionId).eq('tenant_id', session.tenantId).maybeSingle()
  if (!insp) return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })

  const { data: prompt } = await service
    .from('prompts').select('system_prompt').eq('tenant_id', session.tenantId).eq('key', 'photo_label').maybeSingle()

  try {
    const labels = await labelPhotos(valid, {
      notes: typeof context === 'string' ? context : '',
      job: jobContext ?? {},
      guidance: prompt?.system_prompt,
    })
    return NextResponse.json({ ok: labels.some(Boolean), labels })
  } catch (e) {
    if (!(e instanceof PhotoLabelError)) console.error('AI label error:', e)
    return NextResponse.json({ ok: false, labels: [], error: e instanceof PhotoLabelError ? e.message : 'Labelling failed' })
  }
}
