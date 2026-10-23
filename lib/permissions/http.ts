import { NextResponse } from 'next/server'
import type { PermissionKey } from '@/lib/permissions/catalogue'
import { PermissionError, requirePermission } from '@/lib/permissions/resolve'

/**
 * For API routes: null when the user may do the action, otherwise the 403
 * response to return (its error is the message the app shows).
 */
export async function permissionDenied(tenantId: string, userId: string | null | undefined, action: PermissionKey): Promise<NextResponse | null> {
  try {
    await requirePermission(tenantId, userId ?? null, action)
    return null
  } catch (err) {
    if (err instanceof PermissionError) {
      return NextResponse.json({ error: err.message, permission: action, level: err.level }, { status: 403 })
    }
    throw err
  }
}
