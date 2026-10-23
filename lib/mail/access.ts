import { NextResponse } from 'next/server'
import { sessionUser, unauthorized, type SessionUser } from '@/lib/auth/session'
import { permissionDenied } from '@/lib/permissions/http'

/** For the /api/mail routes: who's asking, or the response refusing them */
export async function mailAccess(): Promise<SessionUser | NextResponse> {
  const user = await sessionUser()
  if (!user) return unauthorized()
  const denied = await permissionDenied(user.tenantId, user.userId, 'mail.view')
  if (denied) return denied
  return user
}
