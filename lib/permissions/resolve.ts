import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { createServiceClient } from '@/lib/supabase/server'
import {
  LEVEL_LABELS,
  asRole,
  permissionAction,
  resolveLevels,
  type PermissionKey,
  type PermissionLevel,
  type Role,
} from '@/lib/permissions/catalogue'

// Server-side permission checks (see lib/permissions/catalogue.ts for the
// actions and defaults). Used by the API routes behind the app's buttons and
// by the voice connector, so both refuse the same things.

type Service = SupabaseClient<Database>

export class PermissionError extends Error {
  constructor(message: string, public readonly level: PermissionLevel, public readonly action: PermissionKey) {
    super(message)
    this.name = 'PermissionError'
  }
  readonly status = 403
}

export interface UserPermissions {
  role: Role
  levels: Record<PermissionKey, PermissionLevel>
}

/** A user's role and level for every action. Unknown users get nothing. */
export async function loadUserPermissions(tenantId: string, userId: string, service: Service = createServiceClient()): Promise<UserPermissions> {
  const [userRes, defaultsRes, overridesRes] = await Promise.all([
    service.from('users').select('role').eq('id', userId).eq('tenant_id', tenantId).maybeSingle(),
    service.from('permission_defaults').select('role, action, level').eq('tenant_id', tenantId),
    service.from('user_permission_overrides').select('action, level').eq('tenant_id', tenantId).eq('user_id', userId),
  ])
  if (userRes.error) throw userRes.error
  // Permission tables missing or unreadable → built-in defaults rather than locking everyone out
  if (defaultsRes.error) console.error('[permissions] defaults lookup failed:', defaultsRes.error)
  if (overridesRes.error) console.error('[permissions] overrides lookup failed:', overridesRes.error)

  if (!userRes.data) {
    const levels = resolveLevels('inspector', { roleDefaults: [], userOverrides: [] })
    for (const k of Object.keys(levels) as PermissionKey[]) levels[k] = 'blocked'
    return { role: 'inspector', levels }
  }
  const role = asRole(userRes.data.role)
  return {
    role,
    levels: resolveLevels(role, { roleDefaults: defaultsRes.data ?? [], userOverrides: overridesRes.data ?? [] }),
  }
}

/** What the user is told when an action is refused */
export function refusalMessage(action: PermissionKey, level: PermissionLevel): string {
  const label = permissionAction(action)?.label.toLowerCase() ?? action
  if (level === 'approval') {
    return `Your account needs an admin's approval to ${label}, and approvals aren't set up yet — ask an admin to do it.`
  }
  return `Your account isn't allowed to ${label}. Ask an admin if you need to.`
}

/**
 * Throws PermissionError unless the user is allowed to do the action
 * outright. ("Needs approval" refuses for now — the approval queue comes next.)
 */
export async function requirePermission(tenantId: string, userId: string | null, action: PermissionKey, service?: Service): Promise<void> {
  if (!userId) throw new PermissionError(refusalMessage(action, 'blocked'), 'blocked', action)
  const { levels } = await loadUserPermissions(tenantId, userId, service)
  const level = levels[action]
  if (level !== 'allowed') throw new PermissionError(refusalMessage(action, level), level, action)
}

export { LEVEL_LABELS }
