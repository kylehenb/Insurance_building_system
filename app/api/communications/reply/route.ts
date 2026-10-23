import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'
import { createClient } from '@/lib/supabase/server'
import { ReplyError, replyToEmail } from '@/lib/communications/reply'
import { permissionGate } from '@/lib/permissions/http'
import { recordOperation } from '@/lib/activity/log'

// Reply box on the comms log (see lib/communications/reply.ts).
export async function POST(req: NextRequest) {
  const userSession = await getUser()
  if (!userSession?.tenant_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = userSession.tenant_id

  let commId: string
  let body: string
  try {
    const parsed = await req.json() as { commId?: unknown; body?: unknown }
    if (typeof parsed.commId !== 'string' || !parsed.commId) {
      return NextResponse.json({ error: 'commId is required' }, { status: 400 })
    }
    if (typeof parsed.body !== 'string' || !parsed.body.trim()) {
      return NextResponse.json({ error: 'body is required' }, { status: 400 })
    }
    commId = parsed.commId
    body = parsed.body.trim()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const gated = await permissionGate(tenantId, userSession.session?.user.id, 'send.replies', { operation: 'reply.send', payload: { commId, body } })
  if (gated) return gated

  try {
    // RLS-scoped client, plus the explicit tenant filter in replyToEmail
    await replyToEmail(await createClient(), tenantId, commId, body)
  } catch (err) {
    if (err instanceof ReplyError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
  await recordOperation({ tenantId, userId: userSession.session?.user.id, action: 'send.replies', operation: 'reply.send', payload: { commId, body } })
  return NextResponse.json({ ok: true })
}
