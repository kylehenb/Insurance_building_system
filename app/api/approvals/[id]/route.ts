import { NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'
import { ApprovalError, decideApproval, type ApprovalDecision } from '@/lib/approvals/service'

// POST { decision: 'approve' | 'reject' | 'cancel', note? }
// Approving runs the original action, as the person who asked. Who may
// decide is checked in decideApproval (allowed for the action, not their own).
export const dynamic = 'force-dynamic'

const DECISIONS: ApprovalDecision[] = ['approve', 'reject', 'cancel']

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getUser()
  const userId = user?.session?.user.id
  if (!user?.tenant_id || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { decision?: unknown; note?: unknown }
  const decision = body.decision as ApprovalDecision
  if (!DECISIONS.includes(decision)) return NextResponse.json({ error: 'decision must be approve, reject or cancel' }, { status: 400 })

  try {
    const out = await decideApproval({
      tenantId: user.tenant_id, userId, id, decision,
      note: typeof body.note === 'string' ? body.note : null,
    })
    return NextResponse.json(out)
  } catch (err) {
    if (err instanceof ApprovalError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[approvals] decide failed:', err)
    return NextResponse.json({ error: 'Could not record the decision' }, { status: 500 })
  }
}
