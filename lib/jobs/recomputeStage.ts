import { createServiceClient } from '@/lib/supabase/server'
import { fetchJobContext } from './fetchJobContext'
import { getJobStage } from './getJobStage'
import type { JobStageKey } from './getJobStage'
import type { Database } from '@/lib/supabase/database.types'

type JobUpdate = Database['public']['Tables']['jobs']['Update']

/**
 * Recomputes the job stage from live data and persists it to the jobs table.
 * This is the only place in the codebase that writes to current_stage
 * (override_stage for on_hold/cancelled is written separately).
 */
export async function recomputeAndSaveStage(jobId: string): Promise<JobStageKey> {
  const supabase = createServiceClient()
  const context = await fetchJobContext(jobId, supabase)
  const stage = getJobStage(context)

  // current_stage and current_stage_updated_at are not yet in database.types.ts —
  // cast through unknown to the Update type so strict mode accepts the call.
  const patch = {
    current_stage: stage.key,
    current_stage_updated_at: new Date().toISOString(),
  } as unknown as JobUpdate

  const { error } = await supabase
    .from('jobs')
    .update(patch)
    .eq('id', jobId)

  if (error) {
    throw new Error(`Failed to save stage for job ${jobId}: ${error.message}`)
  }

  return stage.key
}
