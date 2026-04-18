import { createServiceClient } from '@/lib/supabase/server'
import { fetchJobContext } from './fetchJobContext'
import { getJobStage } from './getJobStage'
import type { JobStageKey } from './getJobStage'

/**
 * Recomputes the job stage from live data and persists it to the jobs table.
 * This is the only place in the codebase that writes to current_stage
 * (override_stage for on_hold/cancelled is written separately).
 */
export async function recomputeAndSaveStage(jobId: string): Promise<JobStageKey> {
  const supabase = createServiceClient()
  const context = await fetchJobContext(jobId, supabase)
  const stage = getJobStage(context)

  const { error } = await supabase
    .from('jobs')
    .update({
      current_stage: stage.key,
      current_stage_updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', jobId)

  if (error) {
    throw new Error(`Failed to save stage for job ${jobId}: ${error.message}`)
  }

  return stage.key
}
