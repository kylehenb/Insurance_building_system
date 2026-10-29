import type { SupabaseClient } from '@supabase/supabase-js'

// The learning module (tech spec §24), one for every AI feature. Each time a
// person decides on something the AI proposed — confirms it as it was, edits
// it, skips it, or tells the AI what to do instead — the feature records it
// here with the situation it was in. When the AI next proposes something in
// a situation like it, it's shown the most alike past cases and what the
// person actually did, so it picks up their habits — and only where the
// situation matches, not everywhere. Nothing needs reviewing by hand.

/** A feature's situation: flat facts it chooses (sender, insurer, job stage…); null when not known */
export type Situation = Record<string, string | null>

export type LearningOutcome = 'accepted' | 'edited' | 'skipped' | 'instructed'

export type LearningEvent = {
  id: string
  tenant_id: string
  feature: string
  source_table: string | null
  source_id: string | null
  situation: Situation
  situation_text: string | null
  proposed: unknown
  final: unknown
  changes: string[]
  outcome: LearningOutcome
  instruction: string | null
  /** What sort of proposal, for accuracy by kind (an action card's category) */
  kind: string | null
  user_id: string | null
  created_at: string
}

export type NewLearningEvent = {
  tenantId: string
  feature: string
  sourceTable?: string
  sourceId?: string
  situation: Situation
  situationText?: string
  proposed?: unknown
  final?: unknown
  changes?: string[]
  outcome: LearningOutcome
  instruction?: string
  kind?: string | null
  userId?: string | null
}

/** Records one decision. Never throws: learning must not get in the way of the work */
export async function recordLearning(db: SupabaseClient, e: NewLearningEvent): Promise<void> {
  try {
    const { error } = await db.from('learning_events').insert({
      tenant_id: e.tenantId,
      feature: e.feature,
      source_table: e.sourceTable ?? null,
      source_id: e.sourceId ?? null,
      situation: e.situation,
      situation_text: e.situationText ?? null,
      proposed: e.proposed ?? null,
      final: e.final ?? null,
      changes: e.changes ?? [],
      outcome: e.outcome,
      instruction: e.instruction?.trim() || null,
      kind: e.kind ?? null,
      user_id: e.userId || null,
    })
    if (error) console.error(`[learning] ${e.feature} event not recorded:`, error.message)
  } catch (err) {
    console.error(`[learning] ${e.feature} event not recorded:`, err)
  }
}

/**
 * How much each situation fact counts towards two cases being alike. A key
 * listed in `text` is compared by its words (a subject line); the others
 * must be equal (ignoring case).
 */
export type Likeness = { weights: Record<string, number>; text?: string[]; minScore: number }

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2))

/** How alike two situations are: the weights of the facts they share */
export function likeness(a: Situation, b: Situation, { weights, text = [] }: Likeness): number {
  let score = 0
  for (const [key, weight] of Object.entries(weights)) {
    const x = a[key]?.trim()
    const y = b[key]?.trim()
    if (!x || !y) continue
    if (text.includes(key)) {
      const wx = words(x)
      const wy = words(y)
      const shared = [...wx].filter(w => wy.has(w)).length
      const all = new Set([...wx, ...wy]).size
      if (all) score += weight * (shared / all)
    } else if (x.toLowerCase() === y.toLowerCase()) {
      score += weight
    }
  }
  return score
}

/** How far back a feature's cases are looked through */
const LOOK_BACK = 400

/**
 * The past cases most like this situation, most alike first (newer first
 * when equally alike). Cases about `excludeSourceId` (the record being
 * proposed for) are left out. Never throws.
 */
export async function similarCases(
  db: SupabaseClient,
  opts: { tenantId: string; feature: string; situation: Situation; likeness: Likeness; excludeSourceId?: string | null; limit?: number },
): Promise<LearningEvent[]> {
  try {
    const { data, error } = await db.from('learning_events')
      .select('id, tenant_id, feature, source_table, source_id, situation, situation_text, proposed, final, changes, outcome, instruction, kind, user_id, created_at')
      .eq('tenant_id', opts.tenantId).eq('feature', opts.feature)
      .order('created_at', { ascending: false }).limit(LOOK_BACK)
    if (error) throw new Error(error.message)
    return ((data ?? []) as LearningEvent[])
      .filter(e => !opts.excludeSourceId || e.source_id !== opts.excludeSourceId)
      .map(e => ({ e, score: likeness(opts.situation, e.situation ?? {}, opts.likeness) }))
      .filter(x => x.score >= opts.likeness.minScore)
      .sort((x, y) => y.score - x.score || (x.e.created_at < y.e.created_at ? 1 : -1))
      .slice(0, opts.limit ?? 4)
      .map(x => x.e)
  } catch (err) {
    console.error(`[learning] ${opts.feature} cases not read:`, err)
    return []
  }
}

const OUTCOME_WORDS: Record<LearningOutcome, string> = {
  accepted: 'Confirmed as the AI proposed it',
  edited: 'Changed before it was done',
  skipped: 'Skipped — nothing done',
  instructed: 'Sent back with instructions',
}

const day = (iso: string) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', day: 'numeric', month: 'short' }).format(new Date(iso))

/** Past cases as the AI reads them, under a heading; '' when there are none */
export function formatCases(cases: LearningEvent[], who = 'the office'): string {
  if (!cases.length) return ''
  const lines = cases.map((c, i) => [
    `${i + 1}. ${day(c.created_at)} — ${c.situation_text ?? 'A past case'}`,
    `   ${OUTCOME_WORDS[c.outcome]}.`,
    ...(c.changes ?? []).map(line => `   - ${line}`),
    ...(c.instruction ? [`   ${who.replace(/^./, ch => ch.toUpperCase())} said: "${c.instruction}"`] : []),
  ].join('\n'))
  return `WHAT ${who.toUpperCase()} DID IN SIMILAR PAST CASES (most alike first)
These are real decisions, so they show ${who}'s habits: who they write to and copy in, how they word things, which steps they keep, drop or add. Follow them where this case is alike in the ways that matter. Where a past case differs in a way that matters (another sender, insurer or stage), don't carry its habit over. A case confirmed as proposed means that proposal was right.

${lines.join('\n\n')}`
}
