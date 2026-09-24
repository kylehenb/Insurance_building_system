import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { notifySubmissionFailure } from '@/lib/email/notify-submission-failure'

export const dynamic = 'force-dynamic'

// Field report submissions defer AI/report generation to run after the response is sent
// (see app/api/field/[inspectionId]/submit/route.ts). If the server instance is killed or
// times out before that background work finishes, submission_status is left stuck on
// 'processing' with nobody notified. This cron catches that case.
const STUCK_AFTER_MS = 10 * 60 * 1000

function checkCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  return !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`
}

async function checkStuckSubmissions(): Promise<NextResponse> {
  const service = createServiceClient()
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString()

  const { data: stuck } = await service
    .from('inspections')
    .select('id, tenant_id, job_id, inspector_id')
    .eq('submission_status', 'processing')
    .lt('form_submitted_at', cutoff)

  for (const insp of stuck ?? []) {
    await service.from('inspections').update({
      submission_status: 'failed',
      submission_error: 'Submission processing did not complete in time (server may have restarted or timed out).',
    }).eq('id', insp.id).eq('tenant_id', insp.tenant_id)

    await notifySubmissionFailure({
      inspectionId: insp.id,
      inspectorId: insp.inspector_id,
      jobId: insp.job_id,
      errors: ['Processing did not complete in time — the server may have restarted or timed out.'],
    })
  }

  return NextResponse.json({ ok: true, checked: stuck?.length ?? 0 })
}

// Vercel Cron triggers via GET — guard is the same CRON_SECRET Bearer check used by the Gmail crons
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return checkStuckSubmissions()
}
