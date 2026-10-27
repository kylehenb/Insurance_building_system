import { NextRequest, NextResponse, after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { labelPhotos, PhotoLabelError, type PhotoForLabelling } from '@/lib/photos/ai-label'
import { labelPendingPhotos, loadLabelContext } from '@/lib/photos/server-labels'
import { AI_LABEL_BATCH_SIZE } from '@/lib/photos/report-order'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_PHOTO_BASE64 = 2 * 1024 * 1024

// Field photo labelling. The field app uploads photos as they're added and the
// server labels them in batches (lib/photos/server-labels.ts). Body:
//   {}  → label whatever is still waiting (the phone's upload queue is empty,
//         or the inspector pressed "AI Label All Photos"). Runs after the
//         response; the phone picks the labels up from GET /photos?pending=1.
//         { relabel: true } also redoes photos already labelled.
//   { photos: [{ data: base64, mimeType }], context, jobContext } → the older
//         field app: labels the photos sent and returns them in order.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ inspectionId: string }> }
) {
  const { inspectionId } = await params
  const session = await sessionUser()
  if (!session) return unauthorized()

  const body = await req.json().catch(() => ({}))
  const service = createServiceClient()
  const { data: insp } = await service
    .from('inspections').select('id').eq('id', inspectionId).eq('tenant_id', session.tenantId).maybeSingle()
  if (!insp) return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })

  if (!Array.isArray(body?.photos)) {
    if (body?.relabel) {
      await service.from('photos').update({ ai_status: 'pending' })
        .eq('tenant_id', session.tenantId).eq('inspection_id', inspectionId)
        .not('client_id', 'is', null).is('report_id', null).in('ai_status', ['done', 'failed'])
    }
    after(() => labelPendingPhotos(service, session.tenantId, inspectionId, { minBatch: 1 })
      .catch(err => console.error('[photo-labels] flush:', err)))
    return NextResponse.json({ ok: true, queued: true })
  }

  const valid: PhotoForLabelling[] = body.photos.filter((p: PhotoForLabelling) =>
    typeof p?.data === 'string' && p.data.length > 0 && p.data.length <= MAX_PHOTO_BASE64 &&
    typeof p?.mimeType === 'string' && p.mimeType.startsWith('image/'))
  if (!valid.length || valid.length !== body.photos.length) return NextResponse.json({ ok: false, labels: [], error: 'No usable photos sent' }, { status: 400 })
  if (valid.length > AI_LABEL_BATCH_SIZE) return NextResponse.json({ ok: false, labels: [], error: `Send at most ${AI_LABEL_BATCH_SIZE} photos at a time` }, { status: 400 })

  try {
    const ctx = await loadLabelContext(service, session.tenantId, inspectionId, typeof body.context === 'string' ? { notes: body.context } : undefined)
    const { labels } = await labelPhotos(valid, { ...ctx, job: { ...ctx.job, ...(body.jobContext ?? {}) } })
    return NextResponse.json({ ok: labels.some(Boolean), labels })
  } catch (e) {
    if (!(e instanceof PhotoLabelError)) console.error('AI label error:', e)
    return NextResponse.json({ ok: false, labels: [], error: e instanceof PhotoLabelError ? e.message : 'Labelling failed' })
  }
}
