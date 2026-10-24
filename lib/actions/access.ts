import { NextResponse } from 'next/server'
import { sessionUser, unauthorized, type SessionUser } from '@/lib/auth/session'
import { permissionDenied } from '@/lib/permissions/http'

/**
 * For the /api/actions routes: seeing cards needs the mailbox (mail.view);
 * acting on them (confirm, skip, star, ask for one) needs actions.review.
 * Each confirmed step also needs its own permission (checked in callTool).
 */
export async function cardAccess(act: boolean): Promise<SessionUser | NextResponse> {
  const user = await sessionUser()
  if (!user) return unauthorized()
  const denied = await permissionDenied(user.tenantId, user.userId, 'mail.view')
    ?? (act ? await permissionDenied(user.tenantId, user.userId, 'actions.review') : null)
  return denied ?? user
}

export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)
