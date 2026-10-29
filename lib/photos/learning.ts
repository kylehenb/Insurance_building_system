import type { SupabaseClient } from '@supabase/supabase-js'
import { activeLessons, formatLessons } from '@/lib/learning/lessons'
import { recordLearning, similarCases, type Likeness, type Situation } from '@/lib/learning/events'
import type { PhotoCorrection } from './ai-label'
import { photoKindOfLabel } from './report-order'

// Photo labelling on the learning module (tech spec §24.4): when a report is
// locked, its photos' AI labels are compared with the labels that went out,
// and the inspector's renames are recorded (one case per report) with the
// insurer, loss type and report type. Labelling then reads the renames on
// the most alike past reports, newest first, and the lessons.

export const FEATURE = 'photo_labels'

/** Wording habits carry across jobs, so every past report counts; alike ones first */
export const PHOTO_LIKENESS: Likeness = { weights: { insurer: 1, loss_type: 1, report_type: 1 }, minScore: 0 }

/** A rename as recorded: what the AI saw and said, and what went out */
type Rename = { seen: string | null; ai: string; final: string }

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Records how the AI's labels fared on a locked report. No AI-labelled photos: nothing to record. Never throws */
export async function recordPhotoLabels(db: SupabaseClient, tenantId: string, reportId: string, situation: Situation, userId: string | null): Promise<void> {
  try {
    const { data } = await db.from('photos').select('ai_seen, ai_label, ai_kind, label')
      .eq('tenant_id', tenantId).eq('report_id', reportId).not('ai_label', 'is', null)
    const photos = ((data ?? []) as { ai_seen: string | null; ai_label: string; ai_kind: string | null; label: string | null }[])
      // View of Property / Mud Map are fixed labels, not wording to learn from
      .filter(p => p.ai_kind !== 'view_of_property' && p.ai_kind !== 'mud_map')
    if (!photos.length) return
    const renamed: Rename[] = photos
      .filter(p => p.label?.trim() && squash(p.label) !== squash(p.ai_label) && photoKindOfLabel(p.label) === 'other')
      .map(p => ({ seen: p.ai_seen, ai: p.ai_label, final: p.label!.trim() }))
    await recordLearning(db, {
      tenantId, feature: FEATURE, sourceTable: 'reports', sourceId: reportId,
      situation,
      situationText: `Photos on a ${(situation.report_type ?? '').toUpperCase() || 'report'}${situation.insurer ? ` for ${situation.insurer}` : ''}${situation.loss_type ? ` (${situation.loss_type})` : ''}: ${renamed.length} of ${photos.length} renamed`,
      final: renamed,
      changes: renamed.slice(0, 30).map(r => `"${r.ai}" → "${r.final}"`),
      outcome: renamed.length ? 'edited' : 'accepted',
      kind: situation.report_type,
      userId,
    })
  } catch (err) {
    console.error(`[photo-labels] report ${reportId} not learned from:`, err)
  }
}

/** The inspectors' renames on the most alike past reports (newest first among equals), and the lessons, for labelling */
export async function photoLearning(db: SupabaseClient, tenantId: string, situation: Situation, max = 20): Promise<{ corrections: PhotoCorrection[]; lessons: string }> {
  const [cases, lessons] = await Promise.all([
    similarCases(db, { tenantId, feature: FEATURE, situation, likeness: PHOTO_LIKENESS, limit: 8 }),
    activeLessons(db, tenantId, FEATURE),
  ])
  const corrections: PhotoCorrection[] = []
  for (const c of cases) {
    for (const r of (Array.isArray(c.final) ? c.final : []) as Rename[]) {
      if (r?.ai && r.final && corrections.length < max) corrections.push({ seen: r.seen ?? null, aiLabel: r.ai, finalLabel: r.final })
    }
  }
  return { corrections, lessons: formatLessons(lessons, 'the inspectors') }
}
