import { createClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/get-user'
import { NextResponse } from 'next/server'
import { permissionGate } from '@/lib/permissions/http'
import { recordOperation } from '@/lib/activity/log'
import { SetStageError, setJobStage } from '@/lib/jobs/set-stage'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params
    // The tenant comes from the signed-in session, never the request body
    const user = await getUser()
    const tenantId = user?.tenant_id
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = await request.json()
    const { stage } = body

    if (!stage) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const gated = await permissionGate(tenantId, user.session?.user.id, 'jobs.change_stage', { operation: 'job.stage', payload: { jobId, stage } })
    if (gated) return gated

    try {
      await setJobStage(await createClient(), tenantId, jobId, stage)
    } catch (err) {
      if (err instanceof SetStageError) return NextResponse.json({ error: err.message }, { status: 500 })
      throw err
    }

    await recordOperation({ tenantId, userId: user.session?.user.id, action: 'jobs.change_stage', operation: 'job.stage', payload: { jobId, stage } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in stage PATCH endpoint:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
