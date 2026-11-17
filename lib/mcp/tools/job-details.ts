import type { SupabaseClient } from '@supabase/supabase-js'
import type { McpTool, McpToolResult } from '@/lib/mcp/server'
import { isToolResult, jobFromArgs } from '@/lib/mcp/tools/excess'
import {
  CONTACT_ROLES, CONTACT_TYPES, JOB_DETAIL_FIELDS, JOB_DETAIL_FIELD_NAMES, JobDetailsError,
  describeContact, isJobDetailField, updateJobContact, updateJobDetails,
  type ContactChange, type DetailChange, type JobDetailField,
} from '@/lib/jobs/details'
import { LOSS_TYPES } from '@/lib/loss-types'
import { money } from '@/lib/mcp/tools/work-orders'

// Changing a job's details and its contacts by voice — the same fields and
// contacts as the job's Overview → Job Details panel, checked and saved by the
// same lib/jobs/details.ts as its Save (PATCH /api/jobs/[jobId]/details).

const db = (ctx: { supabase: unknown }) => ctx.supabase as SupabaseClient

const spoken = (c: DetailChange, v: DetailChange['to']) =>
  v === null ? 'blank' : JOB_DETAIL_FIELDS[c.field as JobDetailField].kind === 'money' ? money(Number(v)) : `"${v}"`

const MONEY = new Set(JOB_DETAIL_FIELD_NAMES.filter(f => JOB_DETAIL_FIELDS[f].kind === 'money'))

const FIELD_HINTS: Partial<Record<JobDetailField, string>> = {
  claim_number: 'The insurer\'s claim number.',
  property_address: 'The address of the damaged property, in full.',
  loss_type: `One of: ${LOSS_TYPES.join(', ')}.`,
  date_of_loss: 'YYYY-MM-DD.',
  sum_insured: 'Dollars (building sum insured).',
  excess: 'Dollars (building excess on the claim).',
  order_sender_email: 'The email of whoever sent the work order.',
}

export const updateJobDetailsTool: McpTool = {
  name: 'update_job_details',
  title: 'Update job details',
  description: [
    'Changes a job\'s details, as the Job Details panel on the job\'s Overview does: claim number, property address, adjuster, adjuster reference,',
    'loss type, date of loss, sum insured, excess, claim description, special instructions, and who sent the order (name and email).',
    'Give only the fields that change; put a field in "clear" to blank it. Not for people\'s phone numbers or emails — use update_job_contact for the insured, tenant, agent and the like.',
    'Not the insurer, who the job is assigned to or the job number (change those in the app). Read back the job and each change and get a clear yes before calling.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      job_number: { type: 'string', description: 'Job number, e.g. IRC1001.' },
      ...Object.fromEntries(JOB_DETAIL_FIELD_NAMES.map(f => [f, {
        type: MONEY.has(f) ? 'number' : 'string',
        ...(f === 'loss_type' ? { enum: [...LOSS_TYPES] } : {}),
        description: FIELD_HINTS[f] ?? `New ${JOB_DETAIL_FIELDS[f].label}.`,
      }])),
      clear: { type: 'array', items: { type: 'string', enum: JOB_DETAIL_FIELD_NAMES }, description: 'Fields to blank.' },
    },
    required: ['job_number'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  permission: 'jobs.edit',
  async run(args, ctx): Promise<McpToolResult> {
    const changes: Partial<Record<JobDetailField, unknown>> = {}
    for (const f of JOB_DETAIL_FIELD_NAMES) if (args[f] !== undefined) changes[f] = args[f]
    const clear = Array.isArray(args.clear) ? args.clear : []
    const unknown = clear.filter(f => !isJobDetailField(f))
    if (unknown.length) return { text: `Can't clear ${unknown.join(', ')} — the fields are: ${JOB_DETAIL_FIELD_NAMES.join(', ')}.`, isError: true }
    for (const f of clear as JobDetailField[]) {
      if (changes[f] !== undefined) return { text: `${JOB_DETAIL_FIELDS[f].label} is both changed and cleared — which is it?`, isError: true }
      changes[f] = null
    }
    if (!Object.keys(changes).length) return { text: 'Which details should change?', isError: true }

    const job = await jobFromArgs(args, ctx)
    if (isToolResult(job)) return job
    try {
      const { job_number, changed } = await updateJobDetails(db(ctx), ctx.tenantId, job.id, changes)
      if (!changed.length) return { text: `Nothing to change — ${job_number} already has those details.`, data: { job_number, changed } }
      return {
        text: `Updated ${job_number}, ${job.property_address ?? 'no address'}: ${changed.map(c => `${c.label} from ${spoken(c, c.from)} to ${spoken(c, c.to)}`).join('; ')}.`,
        data: { job_number, changed },
      }
    } catch (err) {
      if (err instanceof JobDetailsError) return { text: err.message, isError: true }
      throw err
    }
  },
}

const SLOT_WORDS: Record<string, string> = { insured: 'the insured', additional_1: 'the first additional contact', additional_2: 'the second additional contact' }

export const updateJobContactTool: McpTool = {
  name: 'update_job_contact',
  title: 'Update job contact',
  description: [
    'Changes, adds or removes a person on a job: the insured, or up to two additional contacts (tenant, real estate agent, property manager, broker, owner).',
    'contact is "insured", "additional_1" / "additional_2" (get_job_summary lists them under Contacts) or "new" to add one. Give only what changes: name, phone, email.',
    'roles replaces the contact\'s roles: "auth" (authorises the work and signs), "primary_site" (main contact for site access and bookings), "secondary_site", "broker", "real_estate";',
    'auth and site roles move from whoever had them, and fall back to the insured when no one has them. remove takes an additional contact off.',
    'Read back the job, the person and each change and get a clear yes before calling.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      job_number: { type: 'string', description: 'Job number, e.g. IRC1001.' },
      contact: { type: 'string', enum: ['insured', 'additional_1', 'additional_2', 'new'] },
      name: { type: 'string' },
      phone: { type: 'string', description: 'As the user says it, e.g. 0412 345 678. Empty to clear.' },
      email: { type: 'string', description: 'Empty to clear.' },
      type: { type: 'string', enum: CONTACT_TYPES, description: 'Additional contacts: who they are.' },
      roles: { type: 'array', items: { type: 'string', enum: CONTACT_ROLES } },
      remove: { type: 'boolean', description: 'True to take this additional contact off the job.' },
    },
    required: ['job_number', 'contact'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  permission: 'jobs.edit',
  async run(args, ctx): Promise<McpToolResult> {
    const str = (k: string) => (typeof args[k] === 'string' ? args[k] as string : undefined)
    const change: ContactChange = {
      contact: args.contact as ContactChange['contact'],
      name: str('name'), phone: str('phone'), email: str('email'),
      type: str('type') as ContactChange['type'],
      roles: Array.isArray(args.roles) ? args.roles as ContactChange['roles'] : undefined,
      remove: args.remove === true,
    }
    if (!change.remove && [change.name, change.phone, change.email, change.type, change.roles].every(v => v === undefined)) {
      return { text: 'What should change — the name, phone, email or roles?', isError: true }
    }
    const job = await jobFromArgs(args, ctx)
    if (isToolResult(job)) return job
    try {
      const { job_number, contact, removed, contacts } = await updateJobContact(db(ctx), ctx.tenantId, job.id, change)
      const head = removed
        ? `Removed ${removed.name || SLOT_WORDS[removed.slot]} from ${job_number}.`
        : `${change.contact === 'new' ? 'Added to' : 'Updated on'} ${job_number}, ${job.property_address ?? 'no address'}: ${describeContact(contact!)}.`
      const warn = contact && !contact.phone && !contact.email ? ' They have no phone or email on the job.' : ''
      return {
        text: [`${head}${warn}`, 'Contacts now:', ...contacts.map(c => `- ${c.slot}: ${describeContact(c)}`)].join('\n'),
        data: { job_number, contact, removed, contacts },
      }
    } catch (err) {
      if (err instanceof JobDetailsError) return { text: err.message, isError: true }
      throw err
    }
  },
}
