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

    // Update the job's current_stage
    const { error } = await supabase
      .from('jobs')
      .update({
        current_stage: stage,
        current_stage_updated_at: new Date().toISOString(),
      } as any)
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
