import type { SupabaseClient } from '@supabase/supabase-js'
import type { LearningOutcome } from './events'

// How often the AI gets it right (tech spec §24.6): of the proposals the
// office decided on, the share confirmed as proposed — per feature, per kind
// (an action card's category), this period against the one before. Sending a
// proposal back with instructions isn't a decision: what's then done is.

export type Tally = { decided: number; accepted: number; edited: number; skipped: number; instructed: number }
export type FeatureStats = {
  feature: string
  /** The last `days` days */
  current: Tally
  /** The `days` days before that */
  previous: Tally
  /** The last `days` days by kind, most decided first */
  byKind: (Tally & { kind: string | null })[]
}

const empty = (): Tally => ({ decided: 0, accepted: 0, edited: 0, skipped: 0, instructed: 0 })

function add(t: Tally, outcome: LearningOutcome) {
  t[outcome]++
  if (outcome !== 'instructed') t.decided++
}

/** Untouched share of decided proposals, as a whole percentage; null with nothing decided */
export const accuracy = (t: Tally): number | null => (t.decided ? Math.round((t.accepted / t.decided) * 100) : null)

/** Every feature's tallies over the last `days` days and the period before. Never throws */
export async function learningStats(db: SupabaseClient, tenantId: string, { days = 30, now = new Date() }: { days?: number; now?: Date } = {}): Promise<FeatureStats[]> {
  const start = new Date(now.getTime() - 2 * days * 86_400_000).toISOString()
  const split = new Date(now.getTime() - days * 86_400_000).toISOString()
  try {
    const { data, error } = await db.from('learning_events').select('feature, kind, outcome, created_at')
      .eq('tenant_id', tenantId).gte('created_at', start).limit(20_000)
    if (error) throw new Error(error.message)
    const byFeature = new Map<string, FeatureStats & { kinds: Map<string | null, Tally> }>()
    for (const e of (data ?? []) as { feature: string; kind: string | null; outcome: LearningOutcome; created_at: string }[]) {
      let f = byFeature.get(e.feature)
      if (!f) byFeature.set(e.feature, (f = { feature: e.feature, current: empty(), previous: empty(), byKind: [], kinds: new Map() }))
      if (e.created_at < split) {
        add(f.previous, e.outcome)
        continue
      }
      add(f.current, e.outcome)
      const k = e.kind ?? null
      if (!f.kinds.has(k)) f.kinds.set(k, empty())
      add(f.kinds.get(k)!, e.outcome)
    }
    return [...byFeature.values()].map(({ kinds, ...f }) => ({
      ...f,
      byKind: [...kinds].map(([kind, t]) => ({ kind, ...t })).sort((a, b) => b.decided - a.decided),
    }))
  } catch (err) {
    console.error('[learning] stats not read:', err)
    return []
  }
}
