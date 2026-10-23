import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

// Setting a job's stage by hand (the stage menu on the Quotes tab, and
// approved requests). Also sets the timestamps recomputeAndSaveStage derives
// the stage from — without them, the next quote status change would
// recompute the stage back to where it was.

type JobUpdate = Database['public']['Tables']['jobs']['Update']

export class SetStageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SetStageError'
  }
}

export async function setJobStage(supabase: SupabaseClient<Database>, tenantId: string, jobId: string, stage: string): Promise<void> {
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = {
    current_stage: stage,
    current_stage_updated_at: now,
  }

  if (stage === 'awaiting_signed_document') {
    // "Send for Signature" — mark signoff as sent so recompute returns this stage
    patch.homeowner_signoff_sent_at = now
  } else if (stage === 'signed_build_schedule') {
    // "Receive sign off" — mark signoff received so recompute returns this stage
    patch.homeowner_signoff_received_at = now
  }

  // current_stage* aren't in database.types.ts yet
  const { error } = await supabase
    .from('jobs')
    .update(patch as unknown as JobUpdate)
    .eq('id', jobId)
    .eq('tenant_id', tenantId)

  if (error) {
    console.error('Error updating job stage:', error)
    throw new SetStageError('Failed to update job stage')
  }
}
