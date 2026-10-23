import { NextResponse } from 'next/server'
import type { PermissionKey } from '@/lib/permissions/catalogue'
import { PermissionError, permissionLevel, refusalMessage, requirePermission } from '@/lib/permissions/resolve'
import { requestApproval } from '@/lib/approvals/service'
import type { OperationKey, OperationPayload } from '@/lib/approvals/operations'

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

/**
 * Like permissionDenied, but "needs approval" queues the action instead of
 * refusing it: the request is saved with what to run once approved, and the
 * response says so. It's still a 403, so no screen mistakes it for done —
 * the app shows its error text ("Sent for approval: …") and pendingApproval
 * marks it as a request rather than a refusal.
 */
export async function permissionGate<K extends OperationKey>(
  tenantId: string,
  userId: string | null | undefined,
  action: PermissionKey,
  approval: { operation: K; payload: OperationPayload<K> },
): Promise<NextResponse | null> {
  const level = await permissionLevel(tenantId, userId ?? null, action)
  if (level === 'allowed') return null
  if (level === 'approval' && userId) {
    const requested = await requestApproval({ tenantId, userId, action, operation: approval.operation, payload: approval.payload })
    return NextResponse.json(
      { error: requested.message, pendingApproval: true, approvalId: requested.id, permission: action, level },
      { status: 403 },
    )
  }
  return NextResponse.json({ error: refusalMessage(action, 'blocked'), permission: action, level: 'blocked' }, { status: 403 })
}
