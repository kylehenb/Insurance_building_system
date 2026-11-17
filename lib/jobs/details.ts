import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdditionalContactType, ContactRole, JobContact } from '@/lib/types/contacts'
import { applyContactDefaults } from '@/lib/contacts/defaults'
import { LOSS_TYPES, normaliseLossType } from '@/lib/loss-types'
import { isFieldAppJob } from './field-app'

// Changing a job's details and its contacts (tech spec §10b): the fields and
// contacts the job's Overview → Job Details panel edits. The insured lives in
// two places (jobs.insured_* and the 'insured' entry in jobs.contacts); both
// are changed together so routing (lib/contacts/defaults) and the panel agree.
// Midcity's field-app jobs keep their own details (lib/jobs/field-job-details.ts).
// The caller checks jobs.edit.

export class JobDetailsError extends Error {
  constructor(message: string, public readonly status: 400 | 404 = 400) {
    super(message)
    this.name = 'JobDetailsError'
  }
}

// ── Job details ──

type FieldKind = 'text' | 'long' | 'money' | 'date' | 'email' | 'loss_type'

/** The job details that can be changed, with their spoken label */
export const JOB_DETAIL_FIELDS = {
  claim_number: { label: 'claim number', kind: 'text' },
  property_address: { label: 'property address', kind: 'text' },
  adjuster: { label: 'adjuster', kind: 'text' },
  adjuster_reference: { label: 'adjuster reference', kind: 'text' },
  loss_type: { label: 'loss type', kind: 'loss_type' },
  date_of_loss: { label: 'date of loss', kind: 'date' },
  sum_insured: { label: 'sum insured', kind: 'money' },
  excess: { label: 'excess', kind: 'money' },
  claim_description: { label: 'claim description', kind: 'long' },
  special_instructions: { label: 'special instructions', kind: 'long' },
  order_sender_name: { label: 'order sender name', kind: 'text' },
  order_sender_email: { label: 'order sender email', kind: 'email' },
} as const satisfies Record<string, { label: string; kind: FieldKind }>

export type JobDetailField = keyof typeof JOB_DETAIL_FIELDS
export const JOB_DETAIL_FIELD_NAMES = Object.keys(JOB_DETAIL_FIELDS) as JobDetailField[]
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
    default:
      return String(value).trim().slice(0, kind === 'long' ? MAX_LONG : MAX_TEXT)
  }
}

type JobRow = Record<string, unknown> & { id: string; job_number: string; insurer: string | null }

async function loadJob(db: SupabaseClient, tenantId: string, jobId: string, columns: string): Promise<JobRow> {
  const { data } = await db.from('jobs').select(`id, job_number, insurer, ${columns}`).eq('tenant_id', tenantId).eq('id', jobId).maybeSingle()
  const job = data as JobRow | null
  if (!job) throw new JobDetailsError('Job not found', 404)
  if (isFieldAppJob(job)) throw new JobDetailsError(`${job.job_number} is a Midcity job — change it in the Midcity field app`)
  return job
}

/**
 * Changes some of a job's details. Values are checked first (nothing is saved
 * if one doesn't fit); null or '' clears a field. Returns what changed, from
 * and to — fields already holding the value are left out.
 */
export async function updateJobDetails(
  db: SupabaseClient, tenantId: string, jobId: string, changes: Partial<Record<JobDetailField, unknown>>,
): Promise<{ job_number: string; changed: DetailChange[] }> {
  const fields = Object.keys(changes).filter(isJobDetailField)
  if (!fields.length) throw new JobDetailsError('Say which details to change')
  const cleaned = Object.fromEntries(fields.map(f => [f, cleanDetail(f, changes[f])])) as Record<JobDetailField, JobDetailValue>

  const job = await loadJob(db, tenantId, jobId, fields.join(', '))
  const changed: DetailChange[] = fields
    .filter(f => (job[f] ?? null) !== cleaned[f] && !(typeof job[f] === 'number' && Number(job[f]) === cleaned[f]))
    .map(f => ({ field: f, label: JOB_DETAIL_FIELDS[f].label, from: (job[f] ?? null) as JobDetailValue, to: cleaned[f] }))
  if (changed.length) {
    const patch = Object.fromEntries(changed.map(c => [c.field, c.to]))
    const { error } = await db.from('jobs').update(patch).eq('tenant_id', tenantId).eq('id', jobId)
    if (error) throw new Error(`Could not save the job details: ${error.message}`)
  }
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

/** e.g. "Jane Brown (tenant) — phone 0412 345 678, email jane@x.com; main site contact" */
export function describeContact(c: JobContact): string {
  const who = `${c.name || 'no name'} (${c.slot === 'insured' ? 'insured' : TYPE_LABELS[c.type ?? 'other']})`
  const roles = c.roles.filter(r => r !== 'insured').map(r => ROLE_LABELS[r])
  return `${who} — ${c.phone ? `phone ${c.phone}` : 'no phone'}, ${c.email ? `email ${c.email}` : 'no email'}${roles.length ? `; ${roles.join(', ')}` : ''}`
}

/** The job's contacts as the panel shows them: the insured from jobs.insured_*, then the additional ones */
export function jobContacts(job: Record<string, unknown>): JobContact[] {
  const stored = (Array.isArray(job.contacts) ? job.contacts : []) as JobContact[]
  const prior = stored.find(c => c.slot === 'insured')
  const insured: JobContact = {
    slot: 'insured',
    name: (job.insured_name as string | null) ?? prior?.name ?? '',
    phone: (job.insured_phone as string | null) ?? prior?.phone ?? '',
    email: (job.insured_email as string | null) ?? prior?.email ?? '',
    roles: prior?.roles?.length ? [...prior.roles] : ['insured'],
  }
  const others = stored.filter(c => c.slot === 'additional_1' || c.slot === 'additional_2').map(c => ({ ...c, roles: [...(c.roles ?? [])] }))
  return applyContactDefaults([insured, ...others])
}

const tidy = (v: string | null | undefined) => (v ?? '').trim()

/**
 * Changes, adds or removes one of a job's contacts. Exclusive roles move to
 * this contact from whoever had them; the insured keeps "authorises the work"
 * and "main site contact" when no one else has them. Returns the contact as
 * saved (null when removed) and all the job's contacts.
 */
export async function updateJobContact(
  db: SupabaseClient, tenantId: string, jobId: string, change: ContactChange,
): Promise<{ job_number: string; contact: JobContact | null; removed: JobContact | null; contacts: JobContact[] }> {
  const { contact: which } = change
  if (which !== 'new' && !CONTACT_SLOTS.includes(which)) throw new JobDetailsError('Which contact: the insured, additional_1, additional_2 or new')
  const email = tidy(change.email)
  if (email && !EMAIL.test(email)) throw new JobDetailsError(`"${email}" isn't an email address`)
  if (change.type !== undefined && !CONTACT_TYPES.includes(change.type)) throw new JobDetailsError(`The contact type is one of: ${CONTACT_TYPES.join(', ')}`)
  if (change.roles?.some(r => !CONTACT_ROLES.includes(r))) throw new JobDetailsError(`Roles are: ${CONTACT_ROLES.join(', ')}`)

  const job = await loadJob(db, tenantId, jobId, 'insured_name, insured_phone, insured_email, contacts')
  const stored = (Array.isArray(job.contacts) ? job.contacts : []) as JobContact[]
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
      if (!tidy(change.name) && !tidy(change.phone) && !email) throw new JobDetailsError('A new contact needs a name, phone or email')
      contacts.push({ slot: free, type: change.type ?? 'other', name: '', phone: '', email: '', roles: [] })
      slot = free
    } else {
      if (!contacts.some(c => c.slot === which)) throw new JobDetailsError(`${job.job_number} has no ${which.replace('_', ' ')} contact — use "new" to add one`)
      slot = which
    }
    const target = contacts.find(c => c.slot === slot)!
    if (change.name !== undefined) target.name = tidy(change.name)
    if (change.phone !== undefined) target.phone = tidy(change.phone)
    if (change.email !== undefined) target.email = email.toLowerCase()
    if (change.type !== undefined && slot !== 'insured') target.type = change.type
    if (change.roles) {
      const roles = [...new Set(change.roles)]
      for (const c of contacts) if (c !== target) c.roles = c.roles.filter(r => !(EXCLUSIVE.includes(r) && roles.includes(r)))
      target.roles = [...(slot === 'insured' ? ['insured' as const] : []), ...roles]
    }
  }

  // Someone authorises the work and is the main site contact — the insured if no one else
  const insured = contacts.find(c => c.slot === 'insured')!
  for (const r of REQUIRED) if (!contacts.some(c => c.roles.includes(r))) insured.roles.push(r)
  contacts = applyContactDefaults(contacts)

  // The insured entry is stored only when it was already, or it no longer holds every role by itself
  const keepInsured = stored.some(c => c.slot === 'insured') || contacts.length > 1
  const toStore = contacts.filter(c => c.slot !== 'insured' || keepInsured)
  const { error } = await db.from('jobs').update({
    insured_name: insured.name || null,
    insured_phone: insured.phone || null,
    insured_email: insured.email || null,
    contacts: toStore,
  }).eq('tenant_id', tenantId).eq('id', jobId)
  if (error) throw new Error(`Could not save the contact: ${error.message}`)

  return { job_number: job.job_number, contact: removed ? null : contacts.find(c => c.slot === slot) ?? null, removed, contacts }
}
