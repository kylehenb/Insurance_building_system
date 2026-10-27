import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { downscaleImage } from '@/lib/images/downscale'
import { labelPhotos, relabelWithNotes, type PhotoCorrection, type PhotoLabelContext } from './ai-label'
import { AI_LABEL_BATCH_SIZE, applyAiLabels, groupPhotosForReport, photoKindOfLabel, roomOfLabel, type AiPhotoLabel, type PhotoKind } from './report-order'

// Server side of field photo labelling (tech spec "AI photo labels"):
//   - labelPendingPhotos: called after each field photo upload (and when the
//     phone's queue empties) — claims batches of photos waiting for a label,
//     looks at them and stores what the AI made of each. The phone isn't
//     needed once a photo is uploaded.
//   - finaliseFieldPhotos: at submit — labels anything left, runs the text pass
//     with the finished notes, picks the one View of Property, groups the rest
//     room by room in walk order and attaches the photos to the report.

type Service = SupabaseClient<Database>
type PhotoRow = Database['public']['Tables']['photos']['Row']

/** Long edge of the copy the AI looks at: enough to recognise a room and its damage, a fraction of the tokens */
const AI_IMAGE_EDGE = 768
const PARALLEL_BATCHES = 3
const CORRECTIONS_SCAN = 200

interface DraftShape { raw_report_notes?: unknown; scopeRooms?: unknown }
interface ScopeRoomLike { name?: unknown; room?: unknown; items?: unknown }

/** Scope rooms (names) and a one-line-per-room scope text from the field app's scope rooms. */
export function scopeFromRooms(rooms: unknown): { scopeRooms: string[]; scopeText: string } {
  const list = Array.isArray(rooms) ? (rooms as ScopeRoomLike[]) : []
  const named = list.map(r => ({
    name: String(r?.name ?? r?.room ?? '').trim(),
    items: (Array.isArray(r?.items) ? r.items : []).map(i => String(typeof i === 'object' && i ? (i as { text?: unknown }).text ?? '' : i ?? '').trim()).filter(Boolean),
  })).filter(r => r.name || r.items.length)
  return {
    scopeRooms: [...new Set(named.map(r => r.name).filter(Boolean))],
    scopeText: named.map(r => `${r.name || 'Room'}: ${r.items.join('; ')}`).join('\n'),
  }
}

/** The company's recent label corrections on locked reports: what the AI said, and what it became. */
export async function loadCorrections(service: Service, tenantId: string): Promise<PhotoCorrection[]> {
  const { data } = await service
    .from('photos')
    .select('ai_seen, ai_label, ai_kind, label, reports!inner(is_locked)')
    .eq('tenant_id', tenantId)
    .eq('reports.is_locked', true)
    .not('ai_label', 'is', null)
    .order('ai_labelled_at', { ascending: false })
    .limit(CORRECTIONS_SCAN)
  const squash = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  return (data ?? [])
    // View of Property / Mud Map are fixed labels, not wording to learn from
    .filter(p => p.ai_label && p.label?.trim() && squash(p.label) !== squash(p.ai_label) &&
      p.ai_kind !== 'view_of_property' && p.ai_kind !== 'mud_map' && photoKindOfLabel(p.label) === 'other')
    .map(p => ({ seen: p.ai_seen, aiLabel: p.ai_label!, finalLabel: p.label!.trim() }))
}

/** Notes, scope, job and company guidance for labelling this inspection's photos (from the saved field draft). */
export async function loadLabelContext(
  service: Service,
  tenantId: string,
  inspectionId: string,
  overrides?: { notes?: string; scopeRooms?: unknown },
): Promise<PhotoLabelContext> {
  const { data: insp } = await service
    .from('inspections').select('job_id, field_draft, raw_report_notes').eq('id', inspectionId).eq('tenant_id', tenantId).maybeSingle()
  const draft = (insp?.field_draft ?? {}) as DraftShape
  const [{ data: job }, { data: prompt }, corrections] = await Promise.all([
    insp?.job_id
      ? service.from('jobs').select('loss_type, insurer, property_address').eq('id', insp.job_id).eq('tenant_id', tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
    service.from('prompts').select('system_prompt').eq('tenant_id', tenantId).eq('key', 'photo_label').maybeSingle(),
    loadCorrections(service, tenantId),
  ])
  const notes = overrides?.notes ?? (typeof draft.raw_report_notes === 'string' ? draft.raw_report_notes : insp?.raw_report_notes ?? '')
  return {
    notes: notes ?? '',
    ...scopeFromRooms(overrides?.scopeRooms ?? draft.scopeRooms),
    job: { lossType: job?.loss_type, insurer: job?.insurer, address: job?.property_address },
    guidance: prompt?.system_prompt,
    corrections,
  }
}

async function labelBatch(service: Service, batch: PhotoRow[], ctx: PhotoLabelContext): Promise<void> {
  const images = await Promise.all(batch.map(async p => {
    const { data } = await service.storage.from('photos').download(p.storage_path)
    if (!data) return null
    const small = await downscaleImage(Buffer.from(await data.arrayBuffer()), AI_IMAGE_EDGE, 75)
    return { data: small.data.toString('base64'), mimeType: small.mimeType }
  }))
  const usable = batch.filter((_, i) => images[i])
  try {
    const { labels, model } = await labelPhotos(images.filter((x): x is NonNullable<typeof x> => !!x), ctx)
    const now = new Date().toISOString()
    await Promise.all(batch.map(p => {
      const a = labels[usable.indexOf(p)] ?? null
      return service.from('photos').update(a
        ? {
            ai_status: 'done', ai_seen: a.seen || null, ai_kind: a.kind, ai_label: a.label, ai_room: a.room || null,
            ai_confidence: a.confidence, ai_room_confidence: a.roomConfidence ?? null, ai_model: model, ai_labelled_at: now,
          }
        : { ai_status: 'failed' }).eq('id', p.id).eq('tenant_id', p.tenant_id)
    }))
  } catch (err) {
    console.error('[photo-labels] batch failed:', err)
    // Back in the queue: the next upload, the flush or submit tries again
    await service.from('photos').update({ ai_status: 'pending' }).in('id', batch.map(p => p.id)).eq('tenant_id', batch[0].tenant_id)
    throw err
  }
}

/**
 * Labels this inspection's photos that are waiting, a batch of 8 at a time. With minBatch 8 (after
 * an upload) it only runs once a full batch is waiting, so photos are seen with their neighbours;
 * minBatch 1 (queue empty, or submit) labels whatever is left. Returns how many were labelled.
 */
export async function labelPendingPhotos(
  service: Service,
  tenantId: string,
  inspectionId: string,
  { minBatch = AI_LABEL_BATCH_SIZE, ctx }: { minBatch?: number; ctx?: PhotoLabelContext } = {},
): Promise<number> {
  let context = ctx
  let labelled = 0
  for (;;) {
    // Waiting, or claimed by a run that died (same 5 minutes as claim_photos_for_labelling)
    const stale = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const { count } = await service
      .from('photos').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('inspection_id', inspectionId)
      .or(`ai_status.eq.pending,and(ai_status.eq.labelling,ai_claimed_at.lt.${stale})`)
    if (!count || count < minBatch) return labelled

    const claims = await Promise.all(Array.from({ length: Math.min(PARALLEL_BATCHES, Math.ceil(count / AI_LABEL_BATCH_SIZE)) }, () =>
      service.rpc('claim_photos_for_labelling', { p_tenant_id: tenantId, p_inspection_id: inspectionId, p_limit: AI_LABEL_BATCH_SIZE })))
    const batches = claims.map(c => (c.data ?? []) as PhotoRow[]).filter(b => b.length)
    if (!batches.length) return labelled

    context ??= await loadLabelContext(service, tenantId, inspectionId)
    const results = await Promise.allSettled(batches.map(b => labelBatch(service, b, context!)))
    results.forEach((r, i) => { if (r.status === 'fulfilled') labelled += batches[i].length })
    // A batch that failed goes back to pending; stop rather than retry it straight away
    if (results.some(r => r.status === 'rejected')) return labelled
  }
}

export interface FieldPhotoManifestEntry {
  clientId: string
  label: string
  /** 'inspector' = typed or tagged on the phone: never changed */
  labelSource: 'ai' | 'inspector' | 'none'
}

/**
 * At submit: finishes labelling this inspection's field photos with the final notes and scope,
 * puts them in report order (View of Property, mud maps, then room by room in walk order) and
 * attaches them to the report. Photos already in the report stay ahead of them.
 */
export async function finaliseFieldPhotos(opts: {
  service: Service
  tenantId: string
  inspectionId: string
  reportId: string | null
  manifest: FieldPhotoManifestEntry[]
  notes: string
  scopeRooms: unknown
}): Promise<void> {
  const { service, tenantId, inspectionId, reportId, manifest } = opts
  const ctx = await loadLabelContext(service, tenantId, inspectionId, { notes: opts.notes, scopeRooms: opts.scopeRooms })

  // Anything not labelled yet (fewer than a batch left, or the phone went away before its flush)
  try {
    await labelPendingPhotos(service, tenantId, inspectionId, { minBatch: 1, ctx })
  } catch (err) {
    console.error('[photo-labels] labelling at submit failed:', err)
  }

  const { data } = await service
    .from('photos').select('*')
    .eq('tenant_id', tenantId).eq('inspection_id', inspectionId)
    .not('client_id', 'is', null).is('report_id', null)
    .order('sequence_number', { ascending: true, nullsFirst: false })
  const rows = data ?? []
  if (!rows.length) return

  // The phone's order and labels win; photos it didn't list (a failed delete) go at the end
  const pos = new Map(manifest.map((m, i) => [m.clientId, i]))
  rows.sort((a, b) => (pos.get(a.client_id!) ?? 1e6) - (pos.get(b.client_id!) ?? 1e6))
  const entry = (p: PhotoRow) => manifest[pos.get(p.client_id!) ?? -1]
  const locked = rows.map(p => {
    const m = entry(p)
    if (m) return m.labelSource === 'inspector' && !!m.label.trim()
    return !!p.label?.trim() && p.label !== p.ai_label
  })
  const inspectorLabel = (p: PhotoRow, i: number) => (locked[i] ? (entry(p)?.label ?? p.label ?? '').trim() : '')

  // Text pass: finished notes and scope name the rooms and damage properly
  let finals: ({ room: string; label: string } | null)[] = rows.map(() => null)
  try {
    finals = await relabelWithNotes(rows.map((p, i) => ({
      seen: p.ai_seen,
      room: p.ai_room,
      label: locked[i] ? inspectorLabel(p, i) : p.ai_label ?? '(no label)',
      locked: locked[i] || !p.ai_label,
    })), ctx)
  } catch (err) {
    console.error('[photo-labels] text pass failed, keeping the photo-only labels:', err)
  }

  const ai: (AiPhotoLabel | null)[] = rows.map((p, i) => p.ai_label ? {
    kind: (p.ai_kind as PhotoKind) ?? 'other',
    confidence: p.ai_confidence ?? 0.5,
    label: finals[i]?.label ?? p.ai_label,
  } : null)
  const labels = applyAiLabels(rows.map((p, i) => inspectorLabel(p, i) || null), ai, { keep: i => locked[i] })

  const ordered = groupPhotosForReport(rows.map((p, i) => {
    const room = locked[i] ? roomOfLabel(labels[i]) : (finals[i]?.room || p.ai_room || roomOfLabel(labels[i]))
    const roomConfidence = locked[i] ? 1 : finals[i]?.room ? Math.max(p.ai_room_confidence ?? 0, 0.8) : p.ai_room_confidence
    return { row: p, label: labels[i] || null, aiLabel: locked[i] ? p.ai_label : (labels[i] || p.ai_label), room, roomConfidence }
  }))

  let offset = 0
  if (reportId) {
    const { count } = await service.from('photos').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('report_id', reportId)
    offset = count ?? 0
  }

  for (let i = 0; i < ordered.length; i += 10) {
    await Promise.all(ordered.slice(i, i + 10).map((o, j) =>
      service.from('photos').update({
        label: o.label,
        // What the AI finally suggested: later changes to the label are the corrections it learns from
        ai_label: o.aiLabel,
        sequence_number: offset + i + j + 1,
        report_id: reportId,
      }).eq('id', o.row.id).eq('tenant_id', tenantId)))
  }
}

/** Safety net if finalising fails: attach the field photos to the report in the order taken, so none go missing. */
export async function attachPendingFieldPhotos(service: Service, tenantId: string, inspectionId: string, reportId: string | null): Promise<void> {
  if (!reportId) return
  await service.from('photos').update({ report_id: reportId })
    .eq('tenant_id', tenantId).eq('inspection_id', inspectionId)
    .not('client_id', 'is', null).is('report_id', null)
}
