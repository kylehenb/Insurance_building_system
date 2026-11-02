import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { legacyStage, recomputePhase } from './phase'
import type { JobStageKey } from './getJobStage'

/**
 * Works the job's phase out again now (lib/jobs/phase.ts) — which also
 * writes the matching old stage key to current_stage — and returns that key.
 * Kept for the places that recomputed the old stage straight after a change;
 * the database flags every other change and the minute cron catches it.
 */
export async function recomputeAndSaveStage(jobId: string): Promise<JobStageKey> {
  const db = createServiceClient() as unknown as SupabaseClient
  const out = await recomputePhase(db, jobId)
  if (!out) throw new Error(`Job ${jobId} not found`)
  const { data } = await db.from('jobs').select('override_stage').eq('id', jobId).maybeSingle()
  return legacyStage(out, (data as { override_stage: string | null } | null)?.override_stage ?? null) as JobStageKey
}
