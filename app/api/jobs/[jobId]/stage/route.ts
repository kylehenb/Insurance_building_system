import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params
    const body = await request.json()
    const { tenantId, stage } = body

    if (!tenantId || !stage) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Build the update payload — always update current_stage, and also set
    // the business-logic timestamp fields that recomputeAndSaveStage derives
    // the stage from. Without these, any subsequent quote status change would
    // trigger a recompute that overwrites current_stage back to the previous stage.
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

    const { error } = await supabase
      .from('jobs')
      .update(patch as any)
      .eq('id', jobId)
      .eq('tenant_id', tenantId)

    if (error) {
      console.error('Error updating job stage:', error)
      return NextResponse.json(
        { error: 'Failed to update job stage' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in stage PATCH endpoint:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
