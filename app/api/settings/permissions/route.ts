import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'
import { createServiceClient } from '@/lib/supabase/server'
import { isRole, permissionAction, type PermissionLevel } from '@/lib/permissions/catalogue'
import { loadUserPermissions } from '@/lib/permissions/resolve'
import { permissionDenied } from '@/lib/permissions/http'

// Settings → Users & Permissions.
// GET → users (with role and their own overrides), the tenant's role
//       defaults, and what the signed-in user may do
// PUT → one change, by someone allowed to manage users:
//   { type: 'role_default',  role: 'office'|'inspector', action, level | null }   (null = back to built-in)
//   { type: 'user_override', userId, action, level | null }                       (null = same as role)
//   { type: 'user_role',     userId, role: 'admin'|'office'|'inspector' }
// Admins always have every permission, and nobody can change their own role,
// so the company can't be locked out of this page.
export const dynamic = 'force-dynamic'

const isLevel = (v: unknown): v is PermissionLevel => v === 'allowed' || v === 'approval' || v === 'blocked'

async function session() {
  const user = await getUser()
  const userId = user?.session?.user.id
  if (!user?.tenant_id || !userId) return null
  return { tenantId: user.tenant_id, userId }
}

export async function GET() {
  const me = await session()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = createServiceClient()

  const [usersRes, defaultsRes, overridesRes, mine] = await Promise.all([
    service.from('users').select('id, name, role').eq('tenant_id', me.tenantId).order('name'),
    service.from('permission_defaults').select('role, action, level').eq('tenant_id', me.tenantId),
    service.from('user_permission_overrides').select('user_id, action, level').eq('tenant_id', me.tenantId),
    loadUserPermissions(me.tenantId, me.userId, service),
  ])
  for (const r of [usersRes, defaultsRes, overridesRes]) {
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
  }

  // Email addresses live in auth, not public.users
  const emails = new Map<string, string>()
  const { data: authUsers } = await service.auth.admin.listUsers({ perPage: 1000 })
  for (const u of authUsers?.users ?? []) if (u.email) emails.set(u.id, u.email)

  return NextResponse.json({
    me: { id: me.userId, role: mine.role, canManage: mine.levels['users.manage'] === 'allowed' },
    users: (usersRes.data ?? []).map(u => ({
      id: u.id,
      name: u.name,
      email: emails.get(u.id) ?? null,
      role: u.role,
      overrides: Object.fromEntries((overridesRes.data ?? []).filter(o => o.user_id === u.id).map(o => [o.action, o.level])),
    })),
    roleDefaults: defaultsRes.data ?? [],
  })
}

export async function PUT(req: NextRequest) {
  const me = await session()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denied = await permissionDenied(me.tenantId, me.userId, 'users.manage')
  if (denied) return denied

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const service = createServiceClient()

  // The user being changed must be in this tenant
  async function tenantUser(id: unknown) {
    if (typeof id !== 'string') return null
    const { data } = await service.from('users').select('id, role').eq('id', id).eq('tenant_id', me!.tenantId).maybeSingle()
    return data
  }
  function checkLevel(action: unknown, level: unknown): string | null {
    const a = typeof action === 'string' ? permissionAction(action) : undefined
    if (!a) return 'Unknown permission'
    if (level !== null && (!isLevel(level) || !a.levels.includes(level))) return `"${a.label}" can't be set to that`
    return null
  }

  if (body.type === 'role_default') {
    if (body.role !== 'office' && body.role !== 'inspector') return NextResponse.json({ error: 'Admins always have every permission' }, { status: 400 })
    const bad = checkLevel(body.action, body.level)
    if (bad) return NextResponse.json({ error: bad }, { status: 400 })
    const { error } = body.level === null
      ? await service.from('permission_defaults').delete().eq('tenant_id', me.tenantId).eq('role', body.role).eq('action', body.action as string)
      : await service.from('permission_defaults').upsert({
          tenant_id: me.tenantId, role: body.role, action: body.action as string, level: body.level as string,
          updated_by: me.userId, updated_at: new Date().toISOString(),
        })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.type === 'user_override') {
    const target = await tenantUser(body.userId)
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    if (target.role === 'admin') return NextResponse.json({ error: 'Admins always have every permission — change their role first' }, { status: 400 })
    const bad = checkLevel(body.action, body.level)
    if (bad) return NextResponse.json({ error: bad }, { status: 400 })
    const { error } = body.level === null
      ? await service.from('user_permission_overrides').delete().eq('tenant_id', me.tenantId).eq('user_id', target.id).eq('action', body.action as string)
      : await service.from('user_permission_overrides').upsert({
          tenant_id: me.tenantId, user_id: target.id, action: body.action as string, level: body.level as string,
          updated_by: me.userId, updated_at: new Date().toISOString(),
        })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.type === 'user_role') {
    if (!isRole(body.role)) return NextResponse.json({ error: 'Unknown role' }, { status: 400 })
    if (body.userId === me.userId) return NextResponse.json({ error: 'You can\'t change your own role' }, { status: 400 })
    const target = await tenantUser(body.userId)
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    const { error } = await service.from('users').update({ role: body.role }).eq('id', target.id).eq('tenant_id', me.tenantId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown change' }, { status: 400 })
}
