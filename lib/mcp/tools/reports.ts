import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { spokenDate } from '@/lib/mcp/tools/work-orders'
import { isToolResult, jobFromArgs } from '@/lib/mcp/tools/excess'
import { ReportGenerateError, generateReportDraft } from '@/lib/reports/generate'
import {
  NEW_REPORT_TYPES,
  REPORT_TEXT_FIELDS,
  REPORT_TYPE_LABELS,
  ReportEditError,
  createReport,
  reportLockedReason,
  setReportLocked,
  updateReport,
  type NewReportType,
  type Report,
  type ReportTextField,
} from '@/lib/reports/edit'

// Reports by voice: reading one, creating one (with its invoice, as New
// report does), writing its fields — typed, or drafted by the AI from
// dictated notes exactly like the forms' "AI Generate" — and locking it.
// Through lib/reports/edit.ts and lib/reports/generate.ts.

/** Characters of each field read out; the data has them in full */
const FIELD_TEXT_CHARS = 500

const FIELD_LABELS: Record<ReportTextField, string> = {
  attendance_date: 'Date of attendance', attendance_time: 'Time of attendance', person_met: 'Person met', assessor_name: 'Assessor',
  property_address: 'Property address', insured_name: 'Insured', claim_number: 'Claim number', loss_type: 'Loss type',
  property_description: 'Property description', incident_description: 'Incident description', cause_of_damage: 'Cause of damage',
  how_damage_occurred: 'How the damage occurred', resulting_damage: 'Resulting damage', conclusion: 'Conclusion',
  pre_existing_conditions: 'Pre-existing conditions', maintenance_notes: 'Maintenance notes', raw_report_notes: 'Raw notes (internal)',
  damage_template: 'Damage template', additional_notes: 'Additional notes',
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const clip = (s: string) => (s.length > FIELD_TEXT_CHARS ? `${s.slice(0, FIELD_TEXT_CHARS)}…` : s)

function errorResult(err: unknown): McpToolResult {
  if (err instanceof ReportEditError) return { text: err.message, data: { status: err.status }, isError: true }
  if (err instanceof ReportGenerateError) return { text: `The AI draft failed: ${err.message}. The notes were saved.`, isError: true }
  throw err
}

function reportView(report: Report, jobNumber: string | null) {
  const fields = Object.fromEntries(REPORT_TEXT_FIELDS.map(k => [k, report[k]]))
  const empty = REPORT_TEXT_FIELDS.filter(k => k !== 'raw_report_notes' && k !== 'damage_template' && !report[k]?.toString().trim())
  return {
    report_id: report.id,
    report_ref: report.report_ref,
    job_number: jobNumber,
    type: report.report_type,
    status: report.status,
    locked: !!report.is_locked,
    deleted: !!report.deleted_at,
    created_at: report.created_at,
    fields,
    type_specific_fields: report.type_specific_fields,
    empty_fields: empty,
  }
}
type ReportView = ReturnType<typeof reportView>

const headline = (v: ReportView) =>
  `${v.report_ref ?? 'Report'} on ${v.job_number ?? 'unknown job'} (${REPORT_TYPE_LABELS[v.type] ?? v.type}): ${v.status ?? 'no status'}` +
  `${v.locked ? ', locked' : ', unlocked'}${v.deleted ? ', deleted' : ''}${v.created_at ? `, created ${spokenDate(v.created_at)}` : ''}.`

function describe(v: ReportView): string {
  const filled = REPORT_TEXT_FIELDS.filter(k => typeof v.fields[k] === 'string' && (v.fields[k] as string).trim())
  return [
    headline(v),
    ...filled.map(k => `${FIELD_LABELS[k]}: ${clip((v.fields[k] as string).trim())}`),
    ...(v.empty_fields.length ? [`Still empty: ${v.empty_fields.map(k => FIELD_LABELS[k]).join(', ')}.`] : []),
  ].join('\n')
}

async function loadReport(reportId: string, ctx: McpContext) {
  const { data: report, error } = await ctx.supabase.from('reports').select('*').eq('tenant_id', ctx.tenantId).eq('id', reportId).maybeSingle()
  if (error) throw error
  if (!report) return null
  const { data: job } = await ctx.supabase.from('jobs').select('job_number').eq('tenant_id', ctx.tenantId).eq('id', report.job_id).maybeSingle()
  return reportView(report, job?.job_number ?? null)
}

const notFound = (): McpToolResult => ({ text: 'No such report — use get_report with the job number to list them.', isError: true })

export const getReport: McpTool = {
  name: 'get_report',
  title: 'Get report',
  description: [
    'Reads a report (BAR, make safe, roof, specialist, leak detection): its type, status, whether it\'s locked, and what each field says — attendance, person met, cause of damage, resulting damage, conclusion and so on — plus which fields are still empty.',
    'Give report_id (from list_job_documents), or just job_number to list the job\'s reports and pick one.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      report_id: { type: 'string' },
      job_number: { type: 'string', description: 'Job number, e.g. IRC1001 — lists its reports when no report_id is given.' },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const reportId = str(args.report_id)
    if (!reportId) {
      if (!str(args.job_number)) return { text: 'Which report, or which job?', isError: true }
      const job = await jobFromArgs(args, ctx)
      if (isToolResult(job)) return job
      const { data: reports, error } = await ctx.supabase
        .from('reports').select('*').eq('tenant_id', ctx.tenantId).eq('job_id', job.id).is('deleted_at', null)
        .order('created_at', { ascending: true })
      if (error) throw error
      if (!reports?.length) return { text: `${job.job_number} has no reports.`, data: { job_number: job.job_number, reports: [] } }
      if (reports.length === 1) return getReport.run({ report_id: reports[0].id }, ctx)
      const views = reports.map(r => reportView(r, job.job_number))
      return {
        text: [`${job.job_number} has ${views.length} reports — which one?`, ...views.map(v => `- ${headline(v)}`)].join('\n'),
        data: { job_number: job.job_number, reports: views.map(({ fields: _f, type_specific_fields: _t, ...v }) => v) },
      }
    }
    const view = await loadReport(reportId, ctx)
    if (!view) return notFound()
    return { text: describe(view), data: { report: view } }
  },
}

const FIELDS_SCHEMA = {
  type: 'object',
  description: 'Report fields to set (each replaces what\'s there). Dates YYYY-MM-DD, times HH:MM.',
  properties: Object.fromEntries(REPORT_TEXT_FIELDS.filter(k => k !== 'raw_report_notes').map(k => [k, { type: 'string', description: FIELD_LABELS[k] }])),
  additionalProperties: false,
}

/** Saves fields and/or notes, then runs the AI draft from the notes if asked. Returns what changed. */
async function writeReport(reportId: string, reportType: string, args: Record<string, unknown>, ctx: McpContext): Promise<string[]> {
  const done: string[] = []
  const fields: Partial<Record<ReportTextField, string | null>> = {}
  const given = args.fields && typeof args.fields === 'object' ? args.fields as Record<string, unknown> : {}
  for (const k of REPORT_TEXT_FIELDS) if (k !== 'raw_report_notes' && typeof given[k] === 'string') fields[k] = (given[k] as string).trim() || null
  const notes = typeof args.raw_notes === 'string' ? args.raw_notes.trim() : undefined
  if (notes !== undefined) fields.raw_report_notes = notes || null

  if (Object.keys(fields).length) {
    await updateReport(ctx.supabase, ctx.tenantId, reportId, fields)
    done.push(...Object.keys(fields).map(k => FIELD_LABELS[k as ReportTextField].toLowerCase()))
  }

  if (args.generate_from_notes === true) {
    const { data: current } = await ctx.supabase.from('reports').select('raw_report_notes').eq('tenant_id', ctx.tenantId).eq('id', reportId).maybeSingle()
    const rawDump = current?.raw_report_notes?.trim()
    if (!rawDump) throw new ReportEditError('There are no raw notes to write the report from — give raw_notes', 400)
    const draft = await generateReportDraft({ supabase: ctx.supabase, tenantId: ctx.tenantId, reportType, rawReportDump: rawDump, reportId })
    // As the forms do: every non-empty field the draft returns replaces what's there
    const drafted: Partial<Record<ReportTextField, string>> = {}
    for (const k of REPORT_TEXT_FIELDS) if (k !== 'raw_report_notes' && typeof draft[k] === 'string' && draft[k].trim()) drafted[k] = draft[k]
    if (Object.keys(drafted).length) {
      await updateReport(ctx.supabase, ctx.tenantId, reportId, drafted)
      done.push(`AI draft written from the notes (${Object.keys(drafted).map(k => FIELD_LABELS[k as ReportTextField].toLowerCase()).join(', ')})`)
    } else {
      done.push('AI draft returned nothing to fill in')
    }
  }
  return done
}

export const createReportTool: McpTool = {
  name: 'create_report',
  title: 'Create report',
  description: [
    'Creates a new draft report on a job, like New report on the Reports tab — which also raises the report\'s invoice to the insurer at their price.',
    'Optionally give the dictated site notes as raw_notes and generate_from_notes: true to have the AI write the report from them (as "AI Generate" on the form does), and/or set fields directly.',
    'Check list_job_documents first — the job may already have that report. Read back the job and report type and get a clear yes first.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      job_number: { type: 'string', description: 'Job number, e.g. IRC1001.' },
      report_type: { type: 'string', enum: [...NEW_REPORT_TYPES], description: 'BAR (building assessment), make_safe, roof, specialist or LDR (leak detection).' },
      raw_notes: { type: 'string', description: 'Site notes / dictation (internal, not on the PDF).' },
      generate_from_notes: { type: 'boolean', description: 'Have the AI write the report fields from the raw notes.' },
      fields: FIELDS_SCHEMA,
    },
    required: ['job_number', 'report_type'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  permission: 'jobs.edit',

  async run(args, ctx): Promise<McpToolResult> {
    const type = args.report_type as NewReportType
    if (!NEW_REPORT_TYPES.includes(type)) return { text: `Report type must be one of ${NEW_REPORT_TYPES.join(', ')}.`, isError: true }
    const job = await jobFromArgs(args, ctx)
    if (isToolResult(job)) return job

    let created
    try {
      created = await createReport(ctx.supabase, ctx.tenantId, { jobId: job.id, type })
    } catch (err) {
      return errorResult(err)
    }
    const { report, invoiceRef } = created
    let done: string[] = []
    let problem: string | null = null
    try {
      done = await writeReport(report.id, type, args, ctx)
    } catch (err) {
      problem = errorResult(err).text
    }
    const view = await loadReport(report.id, ctx)
    return {
      text: [
        `Created ${report.report_ref} (${REPORT_TYPE_LABELS[type]}) on ${job.job_number}.`,
        invoiceRef ? `Raised its invoice ${invoiceRef}.` : 'No invoice was raised for it — check the Invoices tab.',
        ...(done.length ? [`Saved: ${done.join('; ')}.`] : []),
        ...(problem ? [problem] : []),
        ...(view && (done.length || problem) ? [describe(view)] : []),
      ].join('\n'),
      data: { report: view, invoice_ref: invoiceRef, ...(problem ? { problems: [problem] } : {}) },
    }
  },
}

export const updateReportTool: McpTool = {
  name: 'update_report',
  title: 'Update report',
  description: [
    'Writes an unlocked report\'s fields (each one given replaces what\'s there), saves dictated raw_notes, and/or has the AI write the report from the notes (generate_from_notes, like "AI Generate" on the form — it replaces the fields it fills).',
    'lock: true marks it finished (locked, read-only); lock: false unlocks it to edit. A locked report must be unlocked before its fields change.',
    'Read back what will change and get a clear yes first — especially before generating over fields that are already written.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      report_id: { type: 'string' },
      fields: FIELDS_SCHEMA,
      raw_notes: { type: 'string', description: 'Replaces the site notes / dictation (internal).' },
      generate_from_notes: { type: 'boolean' },
      lock: { type: 'boolean', description: 'true to lock (finish) after the changes; false to unlock before them.' },
    },
    required: ['report_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  permission: 'jobs.edit',

  async run(args, ctx): Promise<McpToolResult> {
    const before = await loadReport(str(args.report_id) ?? '', ctx)
    if (!before) return notFound()
    const reportId = before.report_id
    const writes = (args.fields && typeof args.fields === 'object' && Object.keys(args.fields).length) || typeof args.raw_notes === 'string' || args.generate_from_notes === true
    if (!writes && typeof args.lock !== 'boolean') return { text: 'What should change on the report?', isError: true }

    const done: string[] = []
    try {
      if (args.lock === false && before.locked) {
        await setReportLocked(ctx.supabase, ctx.tenantId, reportId, false)
        done.push('unlocked')
      } else if (writes) {
        const locked = reportLockedReason({ is_locked: before.locked, deleted_at: before.deleted ? 'yes' : null, report_ref: before.report_ref })
        if (locked) return { text: locked, isError: true }
      }
      if (writes) done.push(...await writeReport(reportId, before.type, args, ctx))
      if (args.lock === true && !before.locked) {
        await setReportLocked(ctx.supabase, ctx.tenantId, reportId, true)
        done.push('locked')
      }
    } catch (err) {
      const res = errorResult(err)
      return done.length ? { ...res, text: `Done so far: ${done.join('; ')}. Then: ${res.text}` } : res
    }
    const view = await loadReport(reportId, ctx)
    return {
      text: [`${before.report_ref ?? 'Report'}: ${done.length ? done.join('; ') : 'nothing changed'}.`, ...(view ? [describe(view)] : [])].join('\n'),
      data: { report: view },
    }
  },
}
