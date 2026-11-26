import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActionCard } from '@/lib/actions/cards'
import { recordLearning } from '@/lib/learning/events'
import { activeLessons, formatLessons } from '@/lib/learning/lessons'

// The morning review learning from the office (tech spec §23.14, §24): what
// the office did with IRC's own checks — acted on, or skipped — is recorded
// (feature 'job_watch') and shown to the review before it plans more, so it
// stops planning the kinds the office skips.

export const FEATURE = 'job_watch'
const SHOWN = 20

/** A check of IRC's decided: done (acted on) or skipped. Never throws */
export async function recordWatchDecision(db: SupabaseClient, card: ActionCard, userId: string | null, ended: 'confirmed' | 'skipped'): Promise<void> {
  if (card.follow_up?.kind !== 'watch') return
  try {
    const { data: job } = card.job_id ? await db.from('jobs').select('insurer, current_stage, job_type').eq('id', card.job_id).maybeSingle() : { data: null }
    const j = job as { insurer: string | null; current_stage: string | null; job_type: string | null } | null
    await recordLearning(db, {
      tenantId: card.tenant_id, feature: FEATURE, sourceTable: 'action_queue', sourceId: card.id,
      situation: { kind: 'watch', insurer: j?.insurer ?? null, stage: j?.current_stage ?? null, job_type: j?.job_type ?? null },
      situationText: `IRC's check "${card.title}"${card.follow_up.watch?.why ? ` — planned because: ${card.follow_up.watch.why}` : ''}`,
      proposed: { title: card.title, why: card.follow_up.watch?.why ?? null },
      outcome: ended === 'confirmed' ? 'accepted' : 'skipped', kind: 'watch', userId,
    })
  } catch (err) {
    console.error('[job-review] decision not recorded:', err)
  }
}

/** What the review reads before planning: the lessons, and how the office treated IRC's recent checks */
export async function watchLearning(db: SupabaseClient, tenantId: string): Promise<string> {
  const [lessons, { data }] = await Promise.all([
    activeLessons(db, tenantId, FEATURE),
    db.from('action_queue').select('title, status, outcome, updated_at').eq('tenant_id', tenantId).eq('source', 'followup').eq('rule_key', 'job_watch')
      .in('status', ['done', 'skipped']).order('updated_at', { ascending: false }).limit(SHOWN),
  ])
  const rows = ((data as { title: string; status: string; outcome: string | null }[] | null) ?? [])
    // Ones IRC closed itself aren't the office's verdict
    .filter(r => !(r.outcome ?? '').startsWith('No longer needed') && !(r.outcome ?? '').startsWith('Looks done'))
  const past = rows.length
    ? `HOW THE OFFICE TREATED IRC'S RECENT CHECKS (most recent first — plan fewer of the kinds they skip)\n${rows.map(r => `- ${r.status === 'done' ? 'Acted on' : 'Skipped'}: ${r.title}`).join('\n')}`
    : ''
  return [formatLessons(lessons), past].filter(Boolean).join('\n\n')
}
