import type { SupabaseClient } from '@supabase/supabase-js'

// Lessons (tech spec §24): what the past cases add up to, each with the
// situation it applies to and its track record. Read into a feature's prompt
// beside the similar cases. (Learned lessons come from the nightly review —
// §24 "Next"; the first ones are the Brain's two workflows, migrated.)

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
