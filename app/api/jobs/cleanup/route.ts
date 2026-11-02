import { NextResponse } from 'next/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { cleanupCandidates } from '@/lib/jobs/close'
import { mailDb } from '@/lib/mail/sync'

// GET /api/jobs/cleanup — open jobs with nothing on them for 90 days, each
// with the reason it most likely closed (lib/jobs/close.ts). Nothing is closed
// here: the office ticks them and closes them with POST /api/jobs/close.

export async function GET(): Promise<NextResponse> {
  const user = await sessionUser()
  if (!user) return unauthorized()
  try {
    return NextResponse.json({ candidates: await cleanupCandidates(mailDb(), user.tenantId) })
  } catch (err) {
    console.error('[jobs/cleanup] list failed:', err)
    return NextResponse.json({ error: 'Could not load the old jobs' }, { status: 500 })
  }
}
