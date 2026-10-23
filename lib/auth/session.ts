import { NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'

// For API routes: the signed-in user's tenant and id. Routes use this tenant,
// never a tenantId the browser sends — with the service client, that would
// let anyone signed in reach another company's data.

export interface SessionUser { tenantId: string; userId: string }

export async function sessionUser(): Promise<SessionUser | null> {
  const user = await getUser()
  const userId = user?.session?.user.id
  return user?.tenant_id && userId ? { tenantId: user.tenant_id, userId } : null
}

export const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
