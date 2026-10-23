import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Permissions: how a user's level is worked out, what gets refused (by the
// app's routes and the voice connector alike), and the settings API's guards
// against locking the company out.

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
const writes: { table: string; op: string; row?: Row }[] = []
function query(table: string) {
  const preds: ((r: Row) => boolean)[] = []
  let op: { kind: 'update' | 'delete'; row?: Row } | null = null
  const apply = () => (db[table] ?? []).filter(r => preds.every(p => p(r)))
  const b: Record<string, unknown> = {
    select: () => b,
    order: () => b,
    eq: (c: string, v: unknown) => { preds.push(r => r[c] === v); return b },
    upsert: async (row: Row) => { writes.push({ table, op: 'upsert', row }); return { error: null } },
    update: (row: Row) => { op = { kind: 'update', row }; return b },
    delete: () => { op = { kind: 'delete' }; return b },
    maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) => {
      if (op) writes.push({ table, op: op.kind, row: op.row })
      return Promise.resolve({ data: apply(), error: null }).then(res)
    },
  }
  return b
}
const service = { from: query, auth: { admin: { listUsers: async () => ({ data: { users: [{ id: 'kyle', email: 'kyle@example.com' }] } }) } } }
let sessionUser: string | null = 'kyle'
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => service }))
vi.mock('@/lib/supabase/get-user', () => ({
  getUser: async () => (sessionUser ? { tenant_id: 't1', session: { user: { id: sessionUser } } } : null),
}))

const { resolveLevels, BUILT_IN_DEFAULTS, PERMISSION_ACTIONS, clampLevel } = await import('../catalogue')
const { requirePermission, loadUserPermissions, PermissionError } = await import('../resolve')
const { permissionDenied } = await import('../http')
const { handleMcpMessage } = await import('@/lib/mcp/server')
const { MCP_TOOLS } = await import('@/lib/mcp/tools')
const { GET, PUT } = await import('@/app/api/settings/permissions/route')

beforeEach(() => {
  writes.length = 0
  sessionUser = 'kyle'
  db.users = [
    { id: 'kyle', tenant_id: 't1', name: 'Kyle', role: 'admin' },
    { id: 'olivia', tenant_id: 't1', name: 'Olivia', role: 'office' },
    { id: 'ian', tenant_id: 't1', name: 'Ian', role: 'inspector' },
    { id: 'other', tenant_id: 't2', name: 'Other', role: 'office' },
  ]
  db.permission_defaults = []
  db.user_permission_overrides = []
})

describe('working out a level', () => {
  it('has a built-in default for every action and role, valid for that action', () => {
    for (const role of ['admin', 'office', 'inspector'] as const) {
      for (const a of PERMISSION_ACTIONS) expect((a.levels as readonly string[]).includes(BUILT_IN_DEFAULTS[role][a.key])).toBe(true)
    }
  })

  it('takes the person’s change, then the company’s role default, then the built-in one', () => {
    const rows = {
      roleDefaults: [{ role: 'office', action: 'send.documents', level: 'allowed' }, { role: 'office', action: 'send.replies', level: 'approval' }],
      userOverrides: [{ action: 'send.replies', level: 'blocked' }],
    }
    const levels = resolveLevels('office', rows)
    expect(levels['send.documents']).toBe('allowed')
    expect(levels['send.replies']).toBe('blocked')
    expect(levels['send.signing']).toBe('approval')
  })

  it('never restricts admins, and ignores levels an action can’t take', () => {
    const rows = { roleDefaults: [{ role: 'admin', action: 'users.manage', level: 'blocked' }], userOverrides: [{ action: 'users.manage', level: 'blocked' }] }
    expect(resolveLevels('admin', rows)['users.manage']).toBe('allowed')
    expect(clampLevel('records.delete', 'approval')).toBe('blocked')
    expect(resolveLevels('office', { roleDefaults: [], userOverrides: [{ action: 'records.delete', level: 'approval' }] })['records.delete']).toBe('blocked')
  })

  it('gives someone not in the company nothing', async () => {
    const { levels } = await loadUserPermissions('t1', 'other')
    expect(Object.values(levels).every(l => l === 'blocked')).toBe(true)
  })
})

describe('refusing', () => {
  it('lets allowed through and refuses "needs approval" and "not allowed" with a reason', async () => {
    await expect(requirePermission('t1', 'olivia', 'send.work_orders')).resolves.toBeUndefined()
    await expect(requirePermission('t1', 'olivia', 'send.documents')).rejects.toThrow(/needs an admin's approval to send quotes, reports and invoices/)
    await expect(requirePermission('t1', 'ian', 'send.work_orders')).rejects.toBeInstanceOf(PermissionError)
    await expect(requirePermission('t1', null, 'jobs.notes')).rejects.toThrow(/isn't allowed/)
  })

  it('answers the app with a 403 and the message to show', async () => {
    const res = await permissionDenied('t1', 'ian', 'orders.lodge')
    expect(res?.status).toBe(403)
    expect(await res?.json()).toMatchObject({ error: expect.stringMatching(/isn't allowed to lodge insurer orders/), permission: 'orders.lodge', level: 'blocked' })
    expect(await permissionDenied('t1', 'kyle', 'orders.lodge')).toBeNull()
  })

  it('refuses a voice tool the same way, before it runs', async () => {
    const run = vi.fn(async () => ({ text: 'sent' }))
    const tool = { name: 'send', title: 'Send', description: '', inputSchema: {}, annotations: {}, permission: 'send.work_orders' as const, run }
    const res = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'send' } }, [tool], { supabase: service as never, tenantId: 't1', userId: 'ian' })
    expect(res).toMatchObject({ result: { isError: true, content: [{ text: expect.stringMatching(/isn't allowed to send work orders/) }] } })
    expect(run).not.toHaveBeenCalled()
  })

  it('has a permission on every voice tool that changes or sends something', () => {
    const unguarded = MCP_TOOLS.filter(t => !t.annotations.readOnlyHint && !t.permission && !t.checksOwnPermission).map(t => t.name)
    expect(unguarded).toEqual([])
  })
})

describe('settings API', () => {
  const put = (body: unknown) => PUT(new NextRequest('https://app.test/api/settings/permissions', { method: 'PUT', body: JSON.stringify(body) }))

  it('lists the company’s users with emails and what the viewer may do', async () => {
    const body = await (await GET()).json()
    expect(body.me).toEqual({ id: 'kyle', role: 'admin', canManage: true })
    expect(body.users.map((u: { name: string }) => u.name)).toEqual(['Kyle', 'Olivia', 'Ian'])
    expect(body.users[0].email).toBe('kyle@example.com')
  })

  it('saves role defaults and personal changes, and resets them', async () => {
    expect((await put({ type: 'role_default', role: 'office', action: 'send.documents', level: 'allowed' })).status).toBe(200)
    expect(writes.at(-1)).toMatchObject({ table: 'permission_defaults', op: 'upsert', row: { tenant_id: 't1', role: 'office', action: 'send.documents', level: 'allowed', updated_by: 'kyle' } })
    expect((await put({ type: 'user_override', userId: 'ian', action: 'send.replies', level: null })).status).toBe(200)
    expect(writes.at(-1)).toMatchObject({ table: 'user_permission_overrides', op: 'delete' })
    expect((await put({ type: 'user_role', userId: 'olivia', role: 'inspector' })).status).toBe(200)
    expect(writes.at(-1)).toMatchObject({ table: 'users', op: 'update', row: { role: 'inspector' } })
  })

  it('won’t lock the company out or accept bad changes', async () => {
    expect((await put({ type: 'role_default', role: 'admin', action: 'users.manage', level: 'blocked' })).status).toBe(400)
    expect((await put({ type: 'user_role', userId: 'kyle', role: 'office' })).status).toBe(400)
    expect((await put({ type: 'user_override', userId: 'kyle', action: 'send.replies', level: 'blocked' })).status).toBe(400)
    expect((await put({ type: 'role_default', role: 'office', action: 'records.delete', level: 'approval' })).status).toBe(400)
    expect((await put({ type: 'role_default', role: 'office', action: 'nope', level: 'allowed' })).status).toBe(400)
    expect((await put({ type: 'user_role', userId: 'other', role: 'admin' })).status).toBe(404)
    expect(writes).toHaveLength(0)
  })

  it('only lets people who manage users change anything', async () => {
    sessionUser = 'olivia'
    const res = await put({ type: 'role_default', role: 'office', action: 'send.documents', level: 'allowed' })
    expect(res.status).toBe(403)
    expect(writes).toHaveLength(0)
    expect((await (await GET()).json()).me.canManage).toBe(false)
  })
})
