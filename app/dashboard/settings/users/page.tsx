'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BUILT_IN_DEFAULTS,
  LEVEL_LABELS,
  PERMISSION_ACTIONS,
  ROLES,
  asRole,
  roleLevels,
  type PermissionKey,
  type PermissionLevel,
  type Role,
} from '@/lib/permissions/catalogue'

// Settings → Users & Permissions: each user's role, each role's default level
// per action, and per-person changes from their role. Saved through
// /api/settings/permissions; only people allowed to manage users can change
// anything.

interface UserEntry { id: string; name: string; email: string | null; role: string; overrides: Record<string, string> }
interface PermissionsData {
  me: { id: string; role: string; canManage: boolean }
  users: UserEntry[]
  roleDefaults: { role: string; action: string; level: string }[]
}

type Loaded = { data?: PermissionsData; error?: string }

async function fetchPermissions(): Promise<Loaded> {
  const res = await fetch('/api/settings/permissions')
  const json = await res.json().catch(() => ({}))
  return res.ok ? { data: json as PermissionsData } : { error: json.error ?? 'Could not load users' }
}

const GROUPS = ['Jobs', 'Email', 'Sending', 'Money', 'Admin'] as const

const LEVEL_STYLE: Record<PermissionLevel, string> = {
  allowed: 'text-[#2d6a4f]',
  approval: 'text-[#92400e]',
  blocked: 'text-[#9f1239]',
}

function LevelSelect({ value, levels, disabled, onChange, sameAs }: {
  value: PermissionLevel | null
  levels: readonly PermissionLevel[]
  disabled: boolean
  onChange: (level: PermissionLevel | null) => void
  /** For a person: the option that follows their role, showing the role's level */
  sameAs?: PermissionLevel
}) {
  const shown = value ?? sameAs ?? 'blocked'
  return (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={e => onChange(e.target.value ? e.target.value as PermissionLevel : null)}
      className={`w-full border border-line-3 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-gold disabled:bg-surface disabled:cursor-not-allowed ${LEVEL_STYLE[shown]}`}
    >
      {sameAs !== undefined && <option value="">Same as role ({LEVEL_LABELS[sameAs]})</option>}
      {levels.map(l => <option key={l} value={l}>{LEVEL_LABELS[l]}</option>)}
    </select>
  )
}

export default function UsersPermissionsPage() {
  const [data, setData] = useState<PermissionsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [personId, setPersonId] = useState<string>('')

  const apply = useCallback((result: Loaded) => {
    if (result.data) setData(result.data)
    setError(result.error ?? null)
  }, [])

  useEffect(() => {
    let live = true
    fetchPermissions().then(result => { if (live) apply(result) })
    return () => { live = false }
  }, [apply])

  async function save(change: Record<string, unknown>) {
    setSaving(true)
    setError(null)
    const res = await fetch('/api/settings/permissions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(change),
    })
    const json = await res.json().catch(() => ({}))
    const reloaded = await fetchPermissions()
    apply(res.ok ? reloaded : { ...reloaded, error: json.error ?? 'Could not save' })
    setSaving(false)
  }

  const levelsByRole = useMemo(() => {
    const rows = data?.roleDefaults ?? []
    return Object.fromEntries(ROLES.map(r => [r.key, roleLevels(r.key, rows)])) as Record<Role, Record<PermissionKey, PermissionLevel>>
  }, [data])

  if (!data) {
    return <div className="p-8 text-sm text-subtle">{error ?? 'Loading…'}</div>
  }

  const canManage = data.me.canManage && !saving
  const person = data.users.find(u => u.id === personId) ?? null
  const personRole = person ? asRole(person.role) : null

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <a href="/dashboard/settings" className="text-xs text-subtle hover:text-ink">← Settings</a>
        <h1 className="text-2xl font-semibold text-ink mt-1">Users &amp; Permissions</h1>
        <p className="text-sm text-subtle mt-1">
          Each role has a default for every action — Allowed, Needs approval or Not allowed. New users get their role&apos;s defaults;
          change a role&apos;s defaults below, or change one person further down. Admins can always do everything.
          {!data.me.canManage && ' You can view these but not change them.'}
        </p>
        {error && <p className="text-sm text-[#9f1239] mt-2">{error}</p>}
      </div>

      {/* Users */}
      <section className="mb-8">
        <h2 className="text-xs text-subtle uppercase tracking-wider mb-3">Users</h2>
        <div className="bg-white border border-line-3 rounded-lg divide-y divide-line-3">
          {data.users.map(u => {
            const changes = Object.keys(u.overrides).length
            return (
              <div key={u.id} className="flex items-center gap-4 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink">{u.name}{u.id === data.me.id && <span className="text-subtle font-normal"> (you)</span>}</div>
                  <div className="text-xs text-subtle">{u.email ?? '—'}{changes > 0 && ` · ${changes} personal change${changes === 1 ? '' : 's'}`}</div>
                </div>
                <select
                  value={asRole(u.role)}
                  disabled={!canManage || u.id === data.me.id}
                  onChange={e => save({ type: 'user_role', userId: u.id, role: e.target.value })}
                  className="border border-line-3 rounded px-2 py-1 text-sm bg-white disabled:bg-surface disabled:cursor-not-allowed"
                  title={u.id === data.me.id ? 'You can\'t change your own role' : undefined}
                >
                  {ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
                <button
                  onClick={() => setPersonId(u.id)}
                  className="text-xs text-tan hover:underline"
                >
                  Permissions
                </button>
              </div>
            )
          })}
        </div>
        <p className="text-xs text-subtle mt-2">
          {ROLES.map(r => `${r.label}: ${r.description}.`).join(' ')}
        </p>
      </section>

      {/* Role defaults */}
      <section className="mb-8">
        <h2 className="text-xs text-subtle uppercase tracking-wider mb-3">Role defaults</h2>
        <div className="bg-white border border-line-3 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-subtle border-b border-line-3">
                <th className="px-4 py-2 font-medium">Action</th>
                {ROLES.map(r => <th key={r.key} className="px-2 py-2 font-medium w-40">{r.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {GROUPS.map(group => (
                <GroupRows key={group} group={group}>
                  {PERMISSION_ACTIONS.filter(a => a.group === group).map(a => (
                    <tr key={a.key} className="border-b border-line-3 last:border-0 align-top">
                      <ActionCell action={a} />
                      {ROLES.map(r => {
                        const level = levelsByRole[r.key][a.key]
                        const changed = r.key !== 'admin' && level !== BUILT_IN_DEFAULTS[r.key][a.key]
                        return (
                          <td key={r.key} className="px-2 py-2">
                            {r.key === 'admin'
                              ? <span className={`text-xs ${LEVEL_STYLE.allowed}`}>Allowed</span>
                              : <>
                                  <LevelSelect value={level} levels={a.levels} disabled={!canManage}
                                    onChange={l => l && save({ type: 'role_default', role: r.key, action: a.key, level: l })} />
                                  {changed && (
                                    <button disabled={!canManage} onClick={() => save({ type: 'role_default', role: r.key, action: a.key, level: null })}
                                      className="text-[10px] text-subtle hover:text-ink mt-0.5">
                                      Changed · reset to {LEVEL_LABELS[BUILT_IN_DEFAULTS[r.key][a.key]]}
                                    </button>
                                  )}
                                </>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </GroupRows>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* One person */}
      <section className="mb-8">
        <h2 className="text-xs text-subtle uppercase tracking-wider mb-3">One person</h2>
        <div className="flex items-center gap-3 mb-3">
          <select value={personId} onChange={e => setPersonId(e.target.value)}
            className="border border-line-3 rounded px-2 py-1 text-sm bg-white">
            <option value="">Choose a person…</option>
            {data.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          {person && <span className="text-xs text-subtle">Role: {ROLES.find(r => r.key === personRole)?.label}</span>}
        </div>
        {person && personRole === 'admin' && (
          <p className="text-sm text-subtle">Admins can do everything. Change {person.name}&apos;s role to give them a narrower set.</p>
        )}
        {person && personRole && personRole !== 'admin' && (
          <div className="bg-white border border-line-3 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-subtle border-b border-line-3">
                  <th className="px-4 py-2 font-medium">Action</th>
                  <th className="px-2 py-2 font-medium w-56">{person.name}</th>
                </tr>
              </thead>
              <tbody>
                {GROUPS.map(group => (
                  <GroupRows key={group} group={group}>
                    {PERMISSION_ACTIONS.filter(a => a.group === group).map(a => {
                      const own = person.overrides[a.key] as PermissionLevel | undefined
                      return (
                        <tr key={a.key} className="border-b border-line-3 last:border-0 align-top">
                          <ActionCell action={a} />
                          <td className="px-2 py-2">
                            <LevelSelect value={own ?? null} levels={a.levels} disabled={!canManage}
                              sameAs={levelsByRole[personRole][a.key]}
                              onChange={l => save({ type: 'user_override', userId: person.id, action: a.key, level: l })} />
                          </td>
                        </tr>
                      )
                    })}
                  </GroupRows>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function GroupRows({ group, children }: { group: string; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-surface">
        <td colSpan={4} className="px-4 py-1.5 text-[11px] font-semibold text-subtle uppercase tracking-wider">{group}</td>
      </tr>
      {children}
    </>
  )
}

function ActionCell({ action }: { action: typeof PERMISSION_ACTIONS[number] }) {
  return (
    <td className="px-4 py-2">
      <div className="text-sm text-ink">
        {action.label}
        {!action.enforced && (
          <span className="ml-2 inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-line-3 text-subtle"
            title="Saved now, but the app doesn't check this one yet">
            COMING
          </span>
        )}
      </div>
      <div className="text-xs text-subtle">{action.description}</div>
    </td>
  )
}
