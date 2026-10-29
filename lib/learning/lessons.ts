import type { SupabaseClient } from '@supabase/supabase-js'

// Lessons (tech spec §24): what the past cases add up to, each with the
// situation it applies to and its track record. Read into a feature's prompt
// beside the similar cases. Kept by the nightly review (review.ts, §24.5);
// the first ones were the Brain's two workflows, migrated.

export type Lesson = {
  id: string
  applies_when: string
  lesson: string
  support_count: number
  contradict_count: number
}

/** Lessons a feature works with, best supported first. Never throws */
export async function activeLessons(db: SupabaseClient, tenantId: string, feature: string, limit = 20): Promise<Lesson[]> {
  try {
    const { data, error } = await db.from('learning_lessons')
      .select('id, applies_when, lesson, support_count, contradict_count')
      .eq('tenant_id', tenantId).eq('feature', feature).eq('status', 'active')
      .order('support_count', { ascending: false }).limit(limit)
    if (error) throw new Error(error.message)
    return (data ?? []) as Lesson[]
  } catch (err) {
    console.error(`[learning] ${feature} lessons not read:`, err)
    return []
  }
}

/** Lessons as the AI reads them, under a heading; '' when there are none */
export function formatLessons(lessons: Lesson[], who = 'the office'): string {
  if (!lessons.length) return ''
  return `LESSONS FROM ${who.toUpperCase()}'S PAST DECISIONS
Each applies only when its situation matches this case.

${lessons.map(l => `- When: ${l.applies_when}\n  ${l.lesson.replace(/\n/g, '\n  ')}`).join('\n')}`
}

/** A lesson as the "What the AI has learned" page shows it */
export type LessonView = Lesson & {
  feature: string
  status: 'active' | 'retired'
  source: 'learned' | 'migrated'
  retired_reason: string | null
  created_at: string
  updated_at: string
}

/** Every lesson a company has, active first, then most recently changed */
export async function listLessons(db: SupabaseClient, tenantId: string): Promise<LessonView[]> {
  const { data, error } = await db.from('learning_lessons')
    .select('id, feature, applies_when, lesson, status, source, support_count, contradict_count, retired_reason, created_at, updated_at')
    .eq('tenant_id', tenantId).order('updated_at', { ascending: false }).limit(500)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as LessonView[]
  return [...rows.filter(l => l.status === 'active'), ...rows.filter(l => l.status !== 'active')]
}

/** One lesson, for describing a change to it */
export async function getLesson(db: SupabaseClient, tenantId: string, id: string): Promise<LessonView | null> {
  const { data } = await db.from('learning_lessons')
    .select('id, feature, applies_when, lesson, status, source, support_count, contradict_count, retired_reason, created_at, updated_at')
    .eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  return (data as LessonView | null) ?? null
}

/**
 * A person turns a lesson off (it stops being read, and the nightly review
 * sees who turned it off and won't bring it back without new cases) or back
 * on (its record starts again). Returns the lesson, or null if not found.
 */
export async function setLessonActive(db: SupabaseClient, tenantId: string, id: string, active: boolean, byName: string): Promise<LessonView | null> {
  const change = active
    ? { status: 'active', retired_reason: null, support_count: 0, contradict_count: 0 }
    : { status: 'retired', retired_reason: `Turned off by ${byName}` }
  const { data, error } = await db.from('learning_lessons').update({ ...change, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', id)
    .select('id, feature, applies_when, lesson, status, source, support_count, contradict_count, retired_reason, created_at, updated_at').maybeSingle()
  if (error) throw new Error(error.message)
  return (data as LessonView | null) ?? null
}
