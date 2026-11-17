import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdditionalContactType, ContactRole, JobContact } from '@/lib/types/contacts'
import { applyContactDefaults } from '@/lib/contacts/defaults'
import { LOSS_TYPES, normaliseLossType } from '@/lib/loss-types'

// Changing a job's details and its contacts (tech spec §10b). The one way
// they're saved: the job's Overview → Job Details panel (saveJobEdit, via
// PATCH /api/jobs/[jobId]/details) and the voice tools update_job_details /
// update_job_contact (updateJobDetails / updateJobContact). All three check
// values with cleanDetail and settle contacts with settleContacts, so they
// can't drift apart.
//
// The insured lives in two places (jobs.insured_* and the 'insured' entry in
// jobs.contacts); both are written together so routing (lib/contacts/defaults)
// and the panel agree. The caller checks jobs.edit.

export class JobDetailsError extends Error {
  constructor(message: string, public readonly status: 400 | 404 = 400) {
    super(message)
    this.name = 'JobDetailsError'
  }
}

// ── Job details ──

type FieldKind = 'text' | 'long' | 'money' | 'date' | 'email' | 'loss_type' | 'id'

/**
 * The job details that can be changed, with their spoken label. voice: false
 * are the panel's only — picked from lists there (insurer, invoice to) or not
 * worth saying (who it's assigned to, the overview notes).
 */
export const JOB_DETAIL_FIELDS = {
  claim_number: { label: 'claim number', kind: 'text', voice: true },
  property_address: { label: 'property address', kind: 'text', voice: true },
  adjuster: { label: 'adjuster', kind: 'text', voice: true },
  adjuster_reference: { label: 'adjuster reference', kind: 'text', voice: true },
  loss_type: { label: 'loss type', kind: 'loss_type', voice: true },
  date_of_loss: { label: 'date of loss', kind: 'date', voice: true },
  sum_insured: { label: 'sum insured', kind: 'money', voice: true },
  excess: { label: 'excess', kind: 'money', voice: true },
  claim_description: { label: 'claim description', kind: 'long', voice: true },
  special_instructions: { label: 'special instructions', kind: 'long', voice: true },
  order_sender_name: { label: 'order sender name', kind: 'text', voice: true },
  order_sender_email: { label: 'order sender email', kind: 'email', voice: true },
  insurer: { label: 'insurer', kind: 'text', voice: false },
  client_id: { label: 'insurer client', kind: 'id', voice: false },
  invoice_to: { label: 'invoice to', kind: 'text', voice: false },
  assigned_to: { label: 'assigned to', kind: 'text', voice: false },
  notes: { label: 'overview notes', kind: 'long', voice: false },
} as const satisfies Record<string, { label: string; kind: FieldKind; voice: boolean }>

export type JobDetailField = keyof typeof JOB_DETAIL_FIELDS
export const ALL_DETAIL_FIELDS = Object.keys(JOB_DETAIL_FIELDS) as JobDetailField[]
/** The fields the voice tool changes */
export const JOB_DETAIL_FIELD_NAMES = ALL_DETAIL_FIELDS.filter(f => JOB_DETAIL_FIELDS[f].voice)
export const isJobDetailField = (v: unknown): v is JobDetailField => typeof v === 'string' && v in JOB_DETAIL_FIELDS

export type JobDetailValue = string | number | null
export type DetailChange = { field: string; label: string; from: JobDetailValue; to: JobDetailValue }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_TEXT = 300
const MAX_LONG = 4000

const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim())

/** A value as it will be saved; null clears the field. Throws on one that doesn't fit. */
export function cleanDetail(field: JobDetailField, value: unknown): JobDetailValue {
  const { label, kind } = JOB_DETAIL_FIELDS[field]
  if (blank(value)) return null
  switch (kind) {
    case 'money': {
      const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''))
      if (!Number.isFinite(n) || n < 0) throw new JobDetailsError(`The ${label} must be an amount in dollars`)
      return Math.round(n * 100) / 100
    }
    case 'date': {
      const s = String(value).trim()
      if (!DATE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new JobDetailsError(`The ${label} must be a date like 2026-11-03`)
      return s
    }
    case 'email': {
      const s = String(value).trim()
      if (!EMAIL.test(s)) throw new JobDetailsError(`"${s}" isn't an email address`)
      return s.toLowerCase()
    }
    case 'loss_type': {
      const t = normaliseLossType(value)
      if (!t) throw new JobDetailsError(`The loss type must be one of: ${LOSS_TYPES.join(', ')}`)
      return t
    }
    case 'id':
      return String(value).trim()
    default:
      return String(value).trim().slice(0, kind === 'long' ? MAX_LONG : MAX_TEXT)
  }
}

const sameValue = (a: unknown, b: JobDetailValue) => (a ?? null) === b || (typeof a === 'number' && a === Number(b)) || (typeof a === 'string' && b !== null && Number(a) === b && typeof b === 'number')

/** The changes to a job's details: checked first (throws before anything is saved), unchanged fields left out */
function detailChanges(job: Row, changes: Partial<Record<JobDetailField, unknown>>): DetailChange[] {
  const fields = Object.keys(changes).filter(isJobDetailField)
  const cleaned = fields.map(f => [f, cleanDetail(f, changes[f])] as const)
  return cleaned
    .filter(([f, v]) => !sameValue(job[f], v))
    .map(([f, v]) => ({ field: f, label: JOB_DETAIL_FIELDS[f].label, from: (job[f] ?? null) as JobDetailValue, to: v }))
}

type Row = Record<string, unknown> & { id: string; job_number: string }

const CONTACT_COLUMNS = 'insured_name, insured_phone, insured_email, contacts'

async function loadJob(db: SupabaseClient, tenantId: string, jobId: string, columns: string[]): Promise<Row> {
  const { data } = await db.from('jobs').select(['id', 'job_number', ...new Set(columns)].join(', ')).eq('tenant_id', tenantId).eq('id', jobId).maybeSingle()
  if (!data) throw new JobDetailsError('Job not found', 404)
  return data as unknown as Row
}

async function saveJob(db: SupabaseClient, tenantId: string, jobId: string, patch: Record<string, unknown>) {
  if (!Object.keys(patch).length) return
  const { error } = await db.from('jobs').update(patch).eq('tenant_id', tenantId).eq('id', jobId)
  if (error) throw new Error(`Could not save the job: ${error.message}`)
}

/**
 * Changes some of a job's details (update_job_details). Values are checked
 * first (nothing is saved if one doesn't fit); null or '' clears a field.
 * Returns what changed, from and to.
 */
export async function updateJobDetails(
  db: SupabaseClient, tenantId: string, jobId: string, changes: Partial<Record<JobDetailField, unknown>>,
): Promise<{ job_number: string; changed: DetailChange[] }> {
  const fields = Object.keys(changes).filter(isJobDetailField)
  if (!fields.length) throw new JobDetailsError('Say which details to change')
  fields.forEach(f => cleanDetail(f, changes[f]))
  const job = await loadJob(db, tenantId, jobId, fields)
  const changed = detailChanges(job, changes)
  await saveJob(db, tenantId, jobId, Object.fromEntries(changed.map(c => [c.field, c.to])))
  return { job_number: job.job_number, changed }
}

// ── Contacts ──

export const CONTACT_SLOTS = ['insured', 'additional_1', 'additional_2'] as const
export type ContactSlot = (typeof CONTACT_SLOTS)[number]
export const CONTACT_TYPES: AdditionalContactType[] = ['tenant', 'real_estate', 'property_manager', 'broker', 'owner', 'other']
/** Roles set by hand; 'insured' always belongs to the insured */
export const CONTACT_ROLES: ContactRole[] = ['auth', 'primary_site', 'secondary_site', 'broker', 'real_estate']
/** One contact at a time holds these */
const EXCLUSIVE: ContactRole[] = ['auth', 'primary_site', 'secondary_site']
/** Someone must hold these; the insured does when no one else does */
const REQUIRED: ContactRole[] = ['auth', 'primary_site']

export const ROLE_LABELS: Record<ContactRole, string> = {
  insured: 'insured', auth: 'authorises the work', primary_site: 'main site contact',
  secondary_site: 'second site contact', broker: 'broker', real_estate: 'real estate',
}
const TYPE_LABELS: Record<AdditionalContactType, string> = {
  tenant: 'tenant', real_estate: 'real estate agent', property_manager: 'property manager', broker: 'broker', owner: 'owner', other: 'contact',
}

/** e.g. "Jane Brown (tenant) — phone 0412 345 678, email jane@x.com; main site contact" */
export function describeContact(c: JobContact): string {
  const who = `${c.name || 'no name'} (${c.slot === 'insured' ? 'insured' : TYPE_LABELS[c.type ?? 'other']})`
  const roles = c.roles.filter(r => r !== 'insured').map(r => ROLE_LABELS[r])
  return `${who} — ${c.phone ? `phone ${c.phone}` : 'no phone'}, ${c.email ? `email ${c.email}` : 'no email'}${roles.length ? `; ${roles.join(', ')}` : ''}`
}

const tidy = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** The job's contacts as the panel shows them: the insured from jobs.insured_*, then the additional ones */
export function jobContacts(job: Record<string, unknown>): JobContact[] {
  const stored = (Array.isArray(job.contacts) ? job.contacts : []) as JobContact[]
  const prior = stored.find(c => c.slot === 'insured')
  const pick = (col: string, fallback: string | undefined) => (typeof job[col] === 'string' ? job[col] as string : fallback ?? '')
  const insured: JobContact = {
    slot: 'insured',
    name: pick('insured_name', prior?.name),
    phone: pick('insured_phone', prior?.phone),
    email: pick('insured_email', prior?.email),
    roles: prior?.roles?.length ? [...prior.roles] : ['insured'],
  }
  const others = stored.filter(c => c.slot === 'additional_1' || c.slot === 'additional_2').map(c => ({ ...c, roles: [...(c.roles ?? [])] }))
  return applyContactDefaults([insured, ...others])
}

/**
 * Puts a job's contacts in order: one insured and at most one of each
 * additional slot, tidy values, valid emails and roles, an exclusive role on
 * one contact only (the last one given it wins — pass the changed contact
 * last), and "authorises the work" and "main site contact" on the insured
 * when no one else has them. Throws on an email or role that doesn't fit.
 */
export function settleContacts(contacts: JobContact[], prefer?: ContactSlot): JobContact[] {
  const bySlot = new Map<ContactSlot, JobContact>()
  for (const c of contacts) {
    if (!CONTACT_SLOTS.includes(c.slot)) continue
    const email = tidy(c.email)
    if (email && !EMAIL.test(email)) throw new JobDetailsError(`"${email}" isn't an email address`)
    if (c.slot !== 'insured' && c.type !== undefined && !CONTACT_TYPES.includes(c.type)) throw new JobDetailsError(`The contact type is one of: ${CONTACT_TYPES.join(', ')}`)
    const roles = [...new Set(c.roles ?? [])].filter(r => r !== 'insured')
    if (roles.some(r => !CONTACT_ROLES.includes(r))) throw new JobDetailsError(`Roles are: ${CONTACT_ROLES.join(', ')}`)
    bySlot.set(c.slot, {
      slot: c.slot,
      ...(c.slot !== 'insured' ? { type: c.type ?? 'other' } : {}),
      name: tidy(c.name), phone: tidy(c.phone), email: email.toLowerCase(),
      roles: c.slot === 'insured' ? ['insured', ...roles] : roles,
    })
  }
  if (!bySlot.has('insured')) bySlot.set('insured', { slot: 'insured', name: '', phone: '', email: '', roles: ['insured'] })
  const list = CONTACT_SLOTS.map(s => bySlot.get(s)).filter((c): c is JobContact => !!c)

  // An exclusive role stays with the preferred contact, else the last one holding it
  for (const r of EXCLUSIVE) {
    const holders = list.filter(c => c.roles.includes(r))
    const keep = holders.find(c => c.slot === prefer) ?? holders[holders.length - 1]
    for (const c of holders) if (c !== keep) c.roles = c.roles.filter(x => x !== r)
  }
  const insured = list[0]
  for (const r of REQUIRED) if (!list.some(c => c.roles.includes(r))) insured.roles.push(r)
  return applyContactDefaults(list)
}

/** The jobs columns that store these contacts (the insured in both places) */
function contactsPatch(stored: unknown, contacts: JobContact[]): Record<string, unknown> {
  const insured = contacts.find(c => c.slot === 'insured')!
  // The insured entry is stored only when it was already, or there's anyone else
  const hadInsured = Array.isArray(stored) && (stored as JobContact[]).some(c => c.slot === 'insured')
  const keepInsured = hadInsured || contacts.length > 1
  return {
    insured_name: insured.name || null,
    insured_phone: insured.phone || null,
    insured_email: insured.email || null,
    contacts: contacts.filter(c => c.slot !== 'insured' || keepInsured),
  }
}

export interface ContactChange {
  /** Which contact: the insured, an additional one, or 'new' for the next free additional slot */
  contact: ContactSlot | 'new'
  name?: string | null
  phone?: string | null
  email?: string | null
  /** Additional contacts only */
  type?: AdditionalContactType
  /** Replaces the contact's roles (besides 'insured') */
  roles?: ContactRole[]
  /** Takes an additional contact off the job */
  remove?: boolean
}

/**
 * Changes, adds or removes one of a job's contacts (update_job_contact).
 * Exclusive roles move to this contact from whoever had them. Returns the
 * contact as saved (null when removed) and all the job's contacts.
 */
export async function updateJobContact(
  db: SupabaseClient, tenantId: string, jobId: string, change: ContactChange,
): Promise<{ job_number: string; contact: JobContact | null; removed: JobContact | null; contacts: JobContact[] }> {
  const { contact: which } = change
  if (which !== 'new' && !CONTACT_SLOTS.includes(which)) throw new JobDetailsError('Which contact: the insured, additional_1, additional_2 or new')
  const job = await loadJob(db, tenantId, jobId, CONTACT_COLUMNS.split(', '))
  let contacts = jobContacts(job)
  let removed: JobContact | null = null
  let slot: ContactSlot

  if (change.remove) {
    if (which === 'insured' || which === 'new') throw new JobDetailsError('Only an additional contact can be removed — change the insured\'s details instead')
    removed = contacts.find(c => c.slot === which) ?? null
    if (!removed) throw new JobDetailsError(`${job.job_number} has no ${which.replace('_', ' ')} contact`)
    contacts = contacts.filter(c => c.slot !== which)
    slot = which
  } else {
    if (which === 'new') {
      const free = (['additional_1', 'additional_2'] as const).find(s => !contacts.some(c => c.slot === s))
      if (!free) throw new JobDetailsError(`${job.job_number} already has two additional contacts — change or remove one of them`)
      if (!tidy(change.name) && !tidy(change.phone) && !tidy(change.email)) throw new JobDetailsError('A new contact needs a name, phone or email')
      contacts.push({ slot: free, type: change.type ?? 'other', name: '', phone: '', email: '', roles: [] })
      slot = free
    } else {
      if (!contacts.some(c => c.slot === which)) throw new JobDetailsError(`${job.job_number} has no ${which.replace('_', ' ')} contact — use "new" to add one`)
      slot = which
    }
    const target = contacts.find(c => c.slot === slot)!
    if (change.name !== undefined) target.name = change.name ?? ''
    if (change.phone !== undefined) target.phone = change.phone ?? ''
    if (change.email !== undefined) target.email = change.email ?? ''
    if (change.type !== undefined && slot !== 'insured') target.type = change.type
    if (change.roles) target.roles = change.roles
  }

  const settled = settleContacts(contacts, removed ? undefined : slot)
  await saveJob(db, tenantId, jobId, contactsPatch(job.contacts, settled))
  return { job_number: job.job_number, contact: removed ? null : settled.find(c => c.slot === slot) ?? null, removed, contacts: settled }
}

// ── The Job Details panel's Save ──

export interface JobEdit {
  /** Any of the detail fields; '' or null clears */
  details?: Partial<Record<JobDetailField, unknown>>
  /** The insured's name, phone and email (the panel's Insured fields) */
  insured?: { name?: string | null; phone?: string | null; email?: string | null }
  /** Every contact on the job as the panel's editor holds them (the insured's roles come from its entry) */
  contacts?: JobContact[]
}

/** One line for the who-did-what log, e.g. "claim number, insured phone and contacts" */
export function describeJobEdit(changed: string[]): string {
  if (!changed.length) return 'nothing'
  return changed.length === 1 ? changed[0] : `${changed.slice(0, -1).join(', ')} and ${changed[changed.length - 1]}`
}

/**
 * Saves the Job Details panel: its details and contacts in one write, checked
 * and settled exactly as the voice tools do. Returns the saved values (for
 * the panel to show) and the labels of what changed.
 */
export async function saveJobEdit(
  db: SupabaseClient, tenantId: string, jobId: string, edit: JobEdit,
): Promise<{ job_number: string; saved: Record<string, unknown>; changed: string[] }> {
  const details = Object.fromEntries(Object.entries(edit.details ?? {}).filter(([k]) => isJobDetailField(k))) as Partial<Record<JobDetailField, unknown>>
  const fields = Object.keys(details) as JobDetailField[]
  fields.forEach(f => cleanDetail(f, details[f]))
  const touchesContacts = !!edit.insured || !!edit.contacts
  const job = await loadJob(db, tenantId, jobId, [...fields, ...(touchesContacts ? CONTACT_COLUMNS.split(', ') : [])])

  const detailChanged = detailChanges(job, details)
  const patch: Record<string, unknown> = Object.fromEntries(detailChanged.map(c => [c.field, c.to]))
  const changed = detailChanged.map(c => c.label)

  if (touchesContacts) {
    const current = jobContacts(job)
    const given = edit.contacts ? edit.contacts.map(c => ({ ...c, roles: [...(c.roles ?? [])] })) : current.map(c => ({ ...c, roles: [...c.roles] }))
    let insured = given.find(c => c.slot === 'insured')
    if (!insured) { insured = { ...current[0], roles: [...current[0].roles] }; given.unshift(insured) }
    if (edit.insured) {
      if (edit.insured.name !== undefined) insured.name = edit.insured.name ?? ''
      if (edit.insured.phone !== undefined) insured.phone = edit.insured.phone ?? ''
      if (edit.insured.email !== undefined) insured.email = edit.insured.email ?? ''
    }
    const settled = settleContacts(given)
    const contactChanges: string[] = []
    for (const k of ['name', 'phone', 'email'] as const) {
      if (tidy(current[0][k]).toLowerCase() !== settled[0][k].toLowerCase() || (k !== 'email' && tidy(current[0][k]) !== settled[0][k])) contactChanges.push(`insured ${k}`)
    }
    // The additional contacts, and who holds which role
    const others = (list: JobContact[]) => JSON.stringify(list.map(c => c.slot === 'insured'
      ? [c.slot, [...c.roles].sort()]
      : [c.slot, c.type ?? 'other', tidy(c.name), tidy(c.phone), tidy(c.email).toLowerCase(), [...c.roles].sort()]))
    if (others(current) !== others(settled)) contactChanges.push('contacts')
    if (contactChanges.length) {
      changed.push(...contactChanges)
      Object.assign(patch, contactsPatch(job.contacts, settled))
    }
  }

  await saveJob(db, tenantId, jobId, patch)
  const saved = Object.fromEntries(Object.keys(job).filter(k => k !== 'id').map(k => [k, k in patch ? patch[k] : job[k]]))
  return { job_number: job.job_number, saved, changed: [...new Set(changed)] }
}
