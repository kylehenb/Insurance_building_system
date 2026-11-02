import type { SupabaseClient } from '@supabase/supabase-js'
import { recordLearning, similarCases, formatCases, type Likeness } from '@/lib/learning/events'
import { activeLessons, formatLessons } from '@/lib/learning/lessons'
import { perthDay } from './periods'
import type { Fact, Suggestion, SuggestionKind } from './review'

// The changes the health reviews suggest (tech spec §25.5). Each becomes a
// row the owner can accept, dismiss (with a reason) or mark done. A later
// review raising the same idea adds to its count instead of a new row; one
// like an idea dismissed in the last 6 months is dropped. Every decision is
// recorded in the learning module (feature health_suggestion), so the
// nightly learning review turns them into lessons, and the next review reads
// those lessons, the most alike past decisions, and what's already been
// suggested, accepted and done (followed up as facts).

export const FEATURE = 'health_suggestion'
export type SuggestionStatus = 'open' | 'accepted' | 'dismissed' | 'done'
export type Decision = 'accepted' | 'dismissed' | 'done' | 'open'

export interface SuggestionRow {
  id: string
  tenant_id: string
  review_id: string | null
  last_review_id: string | null
  title: string
  why: string
  kind: SuggestionKind
  effort: Suggestion['effort']
  evidence: Fact[]
  times_raised: number
  status: SuggestionStatus
  note: string | null
  decided_by: string | null
  decided_at: string | null
  done_at: string | null
  created_at: string
}

const COLUMNS = 'id, tenant_id, review_id, last_review_id, title, why, kind, effort, evidence, times_raised, status, note, decided_by, decided_at, done_at, created_at'
const DISMISSED_MEMORY_DAYS = 180

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'have', 'when', 'each', 'more', 'irc', 'make', 'add', 'use'])
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w)))

/** How alike two suggestion titles are, 0 to 1 (shared words over all words). */
export function alike(a: string, b: string): number {
  const x = words(a)
  const y = words(b)
  const all = new Set([...x, ...y]).size
  return all ? [...x].filter(w => y.has(w)).length / all : 0
}
const SAME = 0.5

/** Saves a review's suggestions: new ones as open, repeats counted, ones like a recent dismissal dropped. */
export async function saveSuggestions(db: SupabaseClient, tenantId: string, reviewId: string, suggestions: Suggestion[], facts: Fact[], now: Date = new Date()): Promise<{ added: number; repeated: number; dropped: number }> {
  const { data } = await db.from('health_suggestions').select(COLUMNS).eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(500)
  const existing = (data ?? []) as SuggestionRow[]
  const byId = new Map(facts.map(f => [f.id, f]))
  const recentCut = new Date(now.getTime() - DISMISSED_MEMORY_DAYS * 86_400_000).toISOString()
  const result = { added: 0, repeated: 0, dropped: 0 }

  for (const s of suggestions) {
    const match = existing
      .map(e => ({ e, score: alike(e.title, s.title) }))
      .filter(x => x.score >= SAME)
      .sort((a, b) => b.score - a.score)[0]?.e
    if (match?.status === 'dismissed' && (match.decided_at ?? match.created_at) >= recentCut) { result.dropped++; continue }
    if (match && match.status !== 'dismissed') {
      if (match.last_review_id !== reviewId) {
        const times = match.times_raised + 1
        await db.from('health_suggestions').update({ times_raised: times, last_review_id: reviewId, updated_at: now.toISOString() }).eq('id', match.id)
        Object.assign(match, { times_raised: times, last_review_id: reviewId })
      }
      result.repeated++
      continue
    }
    const row = {
      tenant_id: tenantId, review_id: reviewId, last_review_id: reviewId,
      title: s.title, why: s.why, kind: s.kind, effort: s.effort, status: 'open', times_raised: 1,
      evidence: s.facts.map(id => byId.get(id)).filter((f): f is Fact => !!f),
    }
    const { data: saved } = await db.from('health_suggestions').insert(row).select(COLUMNS).single()
    if (saved) existing.unshift(saved as SuggestionRow)
    result.added++
  }
  return result
}

export async function listSuggestions(db: SupabaseClient, tenantId: string, opts: { reviewId?: string; statuses?: SuggestionStatus[]; limit?: number } = {}): Promise<SuggestionRow[]> {
  let q = db.from('health_suggestions').select(COLUMNS).eq('tenant_id', tenantId)
  if (opts.reviewId) q = q.or(`review_id.eq.${opts.reviewId},last_review_id.eq.${opts.reviewId}`)
  if (opts.statuses) q = q.in('status', opts.statuses)
  const { data } = await q.order('created_at', { ascending: false }).limit(opts.limit ?? 50)
  return (data ?? []) as SuggestionRow[]
}

export class SuggestionError extends Error {}

const OUTCOME: Record<Exclude<Decision, 'open'>, 'accepted' | 'skipped' | 'instructed'> = { accepted: 'accepted', dismissed: 'skipped', done: 'accepted' }

/**
 * Accept, dismiss, mark done, or reopen a suggestion. Recorded in the
 * learning module with what was suggested beside what was decided.
 */
export async function decideSuggestion(db: SupabaseClient, tenantId: string, id: string, decision: Decision, opts: { userId?: string | null; note?: string | null; now?: Date } = {}): Promise<SuggestionRow> {
  const now = (opts.now ?? new Date()).toISOString()
  const { data } = await db.from('health_suggestions').select(COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  const s = data as SuggestionRow | null
  if (!s) throw new SuggestionError('That suggestion no longer exists')
  const note = opts.note?.trim().slice(0, 1000) || null
  const update: Record<string, unknown> = { status: decision, updated_at: now }
  if (decision === 'open') Object.assign(update, { decided_by: null, decided_at: null, done_at: null, note: null })
  else Object.assign(update, { decided_by: opts.userId ?? null, decided_at: decision === 'done' && s.decided_at ? s.decided_at : now, note: note ?? s.note })
  if (decision === 'done') update.done_at = now
  const { data: saved, error } = await db.from('health_suggestions').update(update).eq('tenant_id', tenantId).eq('id', id).select(COLUMNS).single()
  if (error || !saved) throw new SuggestionError(error?.message ?? 'Could not save the decision')

  if (decision !== 'open') {
    await recordLearning(db, {
      tenantId,
      feature: FEATURE,
      sourceTable: 'health_suggestions',
      sourceId: id,
      situation: situationOf(s),
      situationText: `Suggested (${s.kind}, ${s.effort} effort): ${s.title} — ${s.why}`,
      proposed: { title: s.title, why: s.why, kind: s.kind, effort: s.effort },
      final: { status: decision, note },
      changes: [`${decision === 'dismissed' ? 'Dismissed' : decision === 'done' ? 'Marked done' : 'Accepted'}${note ? `: ${note}` : ''}`],
      outcome: decision === 'dismissed' && note ? 'instructed' : OUTCOME[decision],
      instruction: note ?? undefined,
      kind: s.kind,
      userId: opts.userId ?? null,
    })
  }
  return saved as SuggestionRow
}

const situationOf = (s: Pick<SuggestionRow, 'kind' | 'effort' | 'title'>) => ({ kind: s.kind, effort: s.effort, title: s.title })

const LIKENESS: Likeness = { weights: { kind: 1, title: 3 }, text: ['title'], minScore: 0 }

/**
 * What the review writer reads about earlier suggestions: the lessons learned
 * from the owner's decisions, the most recent decisions, and every suggestion
 * still open, accepted or done (so it doesn't suggest them again).
 */
export async function suggestionContext(db: SupabaseClient, tenantId: string): Promise<string> {
  const [lessons, cases, current] = await Promise.all([
    activeLessons(db, tenantId, FEATURE),
    similarCases(db, { tenantId, feature: FEATURE, situation: {}, likeness: LIKENESS, limit: 10 }),
    listSuggestions(db, tenantId, { limit: 100 }),
  ])
  const recentCut = new Date(Date.now() - DISMISSED_MEMORY_DAYS * 86_400_000).toISOString()
  const listed = current.filter(s => s.status !== 'dismissed' || (s.decided_at ?? s.created_at) >= recentCut)
  const parts = [
    formatLessons(lessons, 'the owner'),
    formatCases(cases, 'the owner'),
    listed.length
      ? `SUGGESTIONS ALREADY MADE (don't suggest these again; a dismissed one stays dismissed unless the facts now show something new)\n${listed.map(s => `- [${s.status}${s.times_raised > 1 ? `, raised ${s.times_raised} times` : ''}] ${s.title}${s.note ? ` — owner's note: "${s.note}"` : ''}`).join('\n')}`
      : '',
  ].filter(Boolean)
  return parts.join('\n\n')
}

/** Facts on changes the owner accepted or made, so the review can follow them up. */
export async function followUpFacts(db: SupabaseClient, tenantId: string): Promise<string[]> {
  const rows = await listSuggestions(db, tenantId, { statuses: ['accepted', 'done'], limit: 20 })
  return rows.map(s => s.status === 'done'
    ? `A change the owner made: "${s.title}" — accepted ${perthDay(s.decided_at ?? s.created_at)}, marked done ${perthDay(s.done_at ?? s.decided_at ?? s.created_at)}${s.note ? ` (note: "${s.note}")` : ''}. It was suggested because: ${s.why}`
    : `A change the owner accepted but hasn't marked done: "${s.title}" — accepted ${perthDay(s.decided_at ?? s.created_at)}. It was suggested because: ${s.why}`)
}
