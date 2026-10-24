// What each user can do, per action, at one of three levels. Client-safe:
// the Users & Permissions settings page reads this, and the server resolves
// a user's level from it (lib/permissions/resolve.ts).
//
// A user's level for an action is, first match wins:
//   1. their own override (user_permission_overrides)
//   2. the tenant's default for their role (permission_defaults)
//   3. BUILT_IN_DEFAULTS below
// Admins always have every action, so nobody can lock the company out.

export type PermissionLevel = 'allowed' | 'approval' | 'blocked'
export type Role = 'admin' | 'office' | 'inspector'

export const ROLES: { key: Role; label: string; description: string }[] = [
  { key: 'admin', label: 'Admin', description: 'Owner / manager — can do everything' },
  { key: 'office', label: 'Office', description: 'Office staff — runs jobs, sends to trades' },
  { key: 'inspector', label: 'Inspector', description: 'Field staff — inspections and notes' },
]

export const LEVEL_LABELS: Record<PermissionLevel, string> = {
  allowed: 'Allowed',
  approval: 'Needs approval',
  blocked: 'Not allowed',
}

export interface PermissionAction {
  key: string
  group: 'Jobs' | 'Email' | 'Sending' | 'Money' | 'Admin'
  label: string
  description: string
  /** Approval makes no sense for some actions (reading, admin) — they're allowed or not */
  levels: PermissionLevel[]
  /**
   * Whether the app checks it yet. Some edits are saved straight from the
   * browser to the database and need database rules before they can be
   * checked — the settings page shows these as "coming".
   */
  enforced: boolean
}

const ALL: PermissionLevel[] = ['allowed', 'approval', 'blocked']
const ON_OFF: PermissionLevel[] = ['allowed', 'blocked']

export const PERMISSION_ACTIONS = [
  // Jobs
  { key: 'jobs.notes', group: 'Jobs', label: 'Add job notes', description: 'Add notes to a job (by voice for now)', levels: ON_OFF, enforced: true },
  { key: 'jobs.edit', group: 'Jobs', label: 'Edit job details', description: 'Change job details, contacts, quotes and reports in the app', levels: ON_OFF, enforced: true },
  { key: 'jobs.change_stage', group: 'Jobs', label: 'Change a job\'s stage', description: 'Move a job to a different stage by hand', levels: ALL, enforced: true },
  { key: 'orders.lodge', group: 'Jobs', label: 'Lodge insurer orders', description: 'Create jobs from insurer orders', levels: ALL, enforced: true },
  { key: 'orders.manage', group: 'Jobs', label: 'Fix and file orders and emails', description: 'Correct or link insurer orders, create orders from emails, file emails on jobs', levels: ALL, enforced: true },
  { key: 'records.delete', group: 'Jobs', label: 'Delete records', description: 'Delete jobs, quotes, reports, work orders and other records', levels: ON_OFF, enforced: true },
  // Email
  { key: 'mail.view', group: 'Email', label: 'Read the office mailbox', description: 'Open the Mail page: every folder of the shared office inbox, not just emails filed on jobs', levels: ON_OFF, enforced: true },
  { key: 'mail.send', group: 'Email', label: 'Send email from the office mailbox', description: 'Write, reply to and forward emails on the Mail page. Needs approval means drafts can be written and an admin approves each send', levels: ALL, enforced: true },
  { key: 'actions.review', group: 'Email', label: 'Review action cards', description: 'Confirm, skip or snooze the AI\'s suggested next steps for incoming email. Each step still needs its own permission (sending, filing…)', levels: ON_OFF, enforced: true },
  { key: 'mail.organise', group: 'Email', label: 'Organise the office mailbox', description: 'Archive, bin, mark as spam and mark read or unread on the Mail page — changes the mailbox in Gmail too', levels: ON_OFF, enforced: true },
  // Sending — anything that leaves the company
  { key: 'send.work_orders', group: 'Sending', label: 'Send work orders to trades', description: 'Email work orders to trades and hand them to Gary', levels: ALL, enforced: true },
  { key: 'send.documents', group: 'Sending', label: 'Send quotes, reports and invoices', description: 'Email documents to insurers or homeowners (or mark them as sent)', levels: ALL, enforced: true },
  { key: 'send.signing', group: 'Sending', label: 'Send documents for signature', description: 'Send, resend or cancel homeowner signing requests (contracts, scope authorisations)', levels: ALL, enforced: true },
  { key: 'send.replies', group: 'Sending', label: 'Reply to emails', description: 'Reply to emails on a job', levels: ALL, enforced: true },
  // Money
  { key: 'financials.view', group: 'Money', label: 'See amounts and margins', description: 'See quote, invoice and work order amounts, margins and the accounts', levels: ON_OFF, enforced: false },
  { key: 'invoices.manage', group: 'Money', label: 'Create and sync invoices', description: 'Raise and edit invoices and push them to the accounting system. Needs approval means an admin does it — browser edits can\'t be queued', levels: ALL, enforced: true },
  { key: 'excess.decide', group: 'Money', label: 'Decide the excess', description: 'Record whether an excess is collected, waived or not applicable', levels: ALL, enforced: true },
  // Admin
  { key: 'settings.edit', group: 'Admin', label: 'Change company settings', description: 'Templates, automation, rates, integrations and company details', levels: ON_OFF, enforced: true },
  { key: 'users.manage', group: 'Admin', label: 'Manage users and permissions', description: 'Change roles and these permissions', levels: ON_OFF, enforced: true },
] as const satisfies readonly PermissionAction[]

export type PermissionKey = typeof PERMISSION_ACTIONS[number]['key']

export const PERMISSION_KEYS = PERMISSION_ACTIONS.map(a => a.key) as PermissionKey[]

export function permissionAction(key: string): PermissionAction | undefined {
  return (PERMISSION_ACTIONS as readonly PermissionAction[]).find(a => a.key === key)
}

/**
 * Built-in defaults, before any changes on the settings page. The thinking:
 * office staff run jobs day to day, but anything that goes to an insurer or
 * a homeowner, or is a legal document, is checked by an admin first;
 * inspectors work in the field and can add notes, everything outward-facing
 * or financial is off. Nobody but admins deletes or changes settings.
 */
export const BUILT_IN_DEFAULTS: Record<Role, Record<PermissionKey, PermissionLevel>> = {
  admin: Object.fromEntries(PERMISSION_KEYS.map(k => [k, 'allowed'])) as Record<PermissionKey, PermissionLevel>,
  office: {
    'jobs.notes': 'allowed',
    'jobs.edit': 'allowed',
    'jobs.change_stage': 'allowed',
    'orders.lodge': 'allowed',
    'orders.manage': 'allowed',
    'records.delete': 'blocked',
    'mail.view': 'allowed',
    'mail.organise': 'allowed',
    'mail.send': 'allowed',
    'actions.review': 'allowed',
    'send.work_orders': 'allowed',
    'send.documents': 'approval',
    'send.signing': 'approval',
    'send.replies': 'allowed',
    'financials.view': 'allowed',
    'invoices.manage': 'approval',
    'excess.decide': 'allowed',
    'settings.edit': 'blocked',
    'users.manage': 'blocked',
  },
  inspector: {
    'jobs.notes': 'allowed',
    'jobs.edit': 'allowed',
    'jobs.change_stage': 'blocked',
    'orders.lodge': 'blocked',
    'orders.manage': 'blocked',
    'records.delete': 'blocked',
    'mail.view': 'blocked',
    'mail.organise': 'blocked',
    'mail.send': 'blocked',
    'actions.review': 'blocked',
    'send.work_orders': 'blocked',
    'send.documents': 'blocked',
    'send.signing': 'blocked',
    'send.replies': 'approval',
    'financials.view': 'blocked',
    'invoices.manage': 'blocked',
    'excess.decide': 'blocked',
    'settings.edit': 'blocked',
    'users.manage': 'blocked',
  },
}

export function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'office' || value === 'inspector'
}

/** Unknown roles get the most limited defaults */
export const asRole = (value: unknown): Role => (isRole(value) ? value : 'inspector')

/** A level the action allows; the nearest stricter one otherwise */
export function clampLevel(key: PermissionKey, level: PermissionLevel): PermissionLevel {
  const allowed = permissionAction(key)?.levels ?? ON_OFF
  if (allowed.includes(level)) return level
  return 'blocked'
}

export interface PermissionRows {
  /** permission_defaults rows: the tenant's changes to a role's defaults */
  roleDefaults: { role: string; action: string; level: string }[]
  /** user_permission_overrides rows for one user */
  userOverrides: { action: string; level: string }[]
}

const isLevel = (v: unknown): v is PermissionLevel => v === 'allowed' || v === 'approval' || v === 'blocked'

/** A role's defaults for the tenant: built-in, with the tenant's changes. */
export function roleLevels(role: Role, rows: PermissionRows['roleDefaults']): Record<PermissionKey, PermissionLevel> {
  const levels = { ...BUILT_IN_DEFAULTS[role] }
  if (role === 'admin') return levels
  for (const r of rows) {
    if (r.role === role && isLevel(r.level) && (PERMISSION_KEYS as string[]).includes(r.action)) {
      levels[r.action as PermissionKey] = clampLevel(r.action as PermissionKey, r.level)
    }
  }
  return levels
}

/** A user's levels: their role's defaults, then their own overrides. */
export function resolveLevels(role: Role, rows: PermissionRows): Record<PermissionKey, PermissionLevel> {
  const levels = roleLevels(role, rows.roleDefaults)
  if (role === 'admin') return levels
  for (const o of rows.userOverrides) {
    if (isLevel(o.level) && (PERMISSION_KEYS as string[]).includes(o.action)) {
      levels[o.action as PermissionKey] = clampLevel(o.action as PermissionKey, o.level)
    }
  }
  return levels
}
