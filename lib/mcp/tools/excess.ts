import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { findJob, money, normaliseJobNumber, spokenDate, type Job } from '@/lib/mcp/tools/work-orders'
import {
  EXCESS_DECISION_LABELS,
  EXCESS_WAIVER_REASONS,
  excessInvoiceStatusLine,
  excessNeedsConfirming,
  type ExcessContext,
  type ExcessDecision,
} from '@/lib/excess/decision'
import { ExcessError, loadExcessContext, recordExcessDecision } from '@/lib/excess/server'

// A job's policy excess by voice: what's on file and what the office decided,
// and recording a decision. The same functions as the job's Excess panel
// (app/api/jobs/[jobId]/excess). Collecting it is done by raising an excess
// invoice — e.g. with the signing request (send_for_signature's excess).

/** Decisions that can be recorded without sending anything — as the Excess panel allows */
const SETTABLE: ExcessDecision[] = ['nil', ...EXCESS_WAIVER_REASONS.map(r => r.value)]

/** The job for a job_number argument, or a result explaining why not. */
export async function jobFromArgs(args: Record<string, unknown>, ctx: McpContext): Promise<Job | McpToolResult> {
  const jobNumber = normaliseJobNumber(typeof args.job_number === 'string' ? args.job_number : '')
  if (!jobNumber) return { text: 'Which job?', isError: true }
  const { job, closeMatches } = await findJob(jobNumber, ctx)
  if (job) return job
  return {
    text: closeMatches.length ? `No job ${jobNumber}. Did you mean ${closeMatches.join(', ')}?` : `No job ${jobNumber} found.`,
    data: { job_number: jobNumber, close_matches: closeMatches },
    isError: true,
  }
}

export const isToolResult = (v: unknown): v is McpToolResult => !!v && typeof v === 'object' && 'text' in v

/** One spoken line about the excess, e.g. "Excess $500 on file — not confirmed yet." */
export function describeExcess(excess: ExcessContext): string {
  if (!excess.applies) return 'No excess — not an insurance job.'
  const amount = excess.amount ? `Excess ${money(excess.amount)} on file` : 'No excess amount on file'
  const decision = excess.decision
    ? `${EXCESS_DECISION_LABELS[excess.decision]}${excess.note ? ` (${excess.note})` : ''}${excess.decidedAt ? `, decided ${spokenDate(excess.decidedAt)}${excess.decidedByName ? ` by ${excess.decidedByName}` : ''}` : ''}`
    : excessNeedsConfirming(excess) ? 'not confirmed yet' : 'no decision recorded yet'
  const invoices = excess.invoices.map(excessInvoiceStatusLine)
  return [`${amount} — ${decision}.`, ...invoices.map(l => `${l}.`)].join(' ')
}

const excessData = (excess: ExcessContext) => ({
  applies: excess.applies,
  amount: excess.amount,
  decision: excess.decision,
  decision_label: excess.decision ? EXCESS_DECISION_LABELS[excess.decision] : null,
  note: excess.note,
  invoices: excess.invoices,
})

export const getJobExcess: McpTool = {
  name: 'get_job_excess',
  title: 'Get job excess',
  description: [
    'The policy excess on a job: the amount on file, what the office decided (collecting, no excess, or not collecting and why),',
    'and any excess invoices with whether they have been paid. Only insurance jobs have an excess.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { job_number: { type: 'string', description: 'Job number, e.g. IRC1001.' } },
    required: ['job_number'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const job = await jobFromArgs(args, ctx)
    if (isToolResult(job)) return job
    const excess = await loadExcessContext(ctx.supabase, ctx.tenantId, job.id)
    return {
      text: `${job.job_number}, ${job.property_address ?? 'no address'}: ${describeExcess(excess)}`,
      data: { job_number: job.job_number, ...excessData(excess) },
    }
  },
}

export const setJobExcessDecision: McpTool = {
  name: 'set_job_excess_decision',
  title: 'Record excess decision',
  description: [
    'Records what the office decided about a job\'s excess, without sending anything:',
    '"nil" (confirmed there is no excess on this claim), or not collecting it because of',
    EXCESS_WAIVER_REASONS.map(r => `"${r.value}" (${r.label})`).join(', ') + '.',
    'To collect an excess, raise an excess invoice instead (send_for_signature can create and attach one).',
    'Read back the job and the decision and get a clear yes before calling.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      job_number: { type: 'string', description: 'Job number, e.g. IRC1001.' },
      decision: { type: 'string', enum: SETTABLE },
      note: { type: 'string', description: 'Optional note, e.g. why it was waived.' },
    },
    required: ['job_number', 'decision'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  permission: 'excess.decide',

  async run(args, ctx): Promise<McpToolResult> {
    const decision = SETTABLE.find(d => d === args.decision)
    if (!decision) return { text: `Decision must be one of: ${SETTABLE.join(', ')}.`, isError: true }
    const job = await jobFromArgs(args, ctx)
    if (isToolResult(job)) return job
    const note = typeof args.note === 'string' ? args.note.slice(0, 1000) : null

    try {
      const before = await loadExcessContext(ctx.supabase, ctx.tenantId, job.id)
      if (!before.applies) return { text: `${job.job_number} isn't an insurance job, so there's no excess to record.`, isError: true }
      await recordExcessDecision(ctx.supabase, { tenantId: ctx.tenantId, jobId: job.id, userId: ctx.userId, decision, note })
      const after = await loadExcessContext(ctx.supabase, ctx.tenantId, job.id)
      return {
        text: `Recorded for ${job.job_number}: ${describeExcess(after)}`,
        data: { job_number: job.job_number, ...excessData(after) },
      }
    } catch (err) {
      if (err instanceof ExcessError) return { text: err.message, data: { status: err.status }, isError: true }
      throw err
    }
  },
}
