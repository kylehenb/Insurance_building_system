import { NextResponse } from 'next/server'
import { sessionUser, unauthorized, type SessionUser } from '@/lib/auth/session'
import { permissionDenied } from '@/lib/permissions/http'
import { permissionLevel, refusalMessage } from '@/lib/permissions/resolve'
import { ComposeError } from './compose'

/** For the /api/mail routes: who's asking, or the response refusing them */
export async function mailAccess(): Promise<SessionUser | NextResponse> {
  const user = await sessionUser()
  if (!user) return unauthorized()
  const denied = await permissionDenied(user.tenantId, user.userId, 'mail.view')
  if (denied) return denied
  return user
}

/**
 * For writing email: mail.view, and mail.send not switched off. "Needs
 * approval" may still write drafts — each send is what gets approved.
 */
export async function composeAccess(): Promise<SessionUser | NextResponse> {
  const user = await mailAccess()
  if (user instanceof NextResponse) return user
  const level = await permissionLevel(user.tenantId, user.userId, 'mail.send')
  if (level === 'blocked') {
    return NextResponse.json({ error: refusalMessage('mail.send', 'blocked'), permission: 'mail.send', level }, { status: 403 })
  }
  return user
}

/** The response for a ComposeError, or rethrows anything else */
export function composeErrorResponse(err: unknown, what: string): NextResponse {
  if (err instanceof ComposeError) return NextResponse.json({ error: err.message }, { status: err.status })
  console.error(`[mail] ${what} failed:`, err)
  return NextResponse.json({ error: err instanceof Error ? err.message : `Could not ${what}` }, { status: 502 })
}
