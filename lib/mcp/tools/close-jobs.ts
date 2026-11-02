import type { SupabaseClient } from '@supabase/supabase-js'
import type { McpTool, McpToolResult } from '@/lib/mcp/server'
import { CLOSE_REASONS, CloseJobError, closeJobs, isCloseReason, reopenJob } from '@/lib/jobs/close'
import { CLOSED_LABELS } from '@/lib/jobs/phase'
import { isToolResult, jobFromArgs } from '@/lib/mcp/tools/excess'

// Closing a job by hand, and reopening it, by voice. The same functions as
// Jobs → Close Old Jobs and the Reopen link on the job's banner
// (lib/jobs/close.ts, /api/jobs/close).

const db = (ctx: { supabase: unknown }) => ctx.supabase as SupabaseClient

export const closeJobTool: McpTool = {
  name: 'close_job',
  title: 'Close job',
  description: [
    'Closes a job by hand with its reason: "complete" (work done and invoiced), "declined" (the claim or quote was declined),',
    '"cancelled" (the job was withdrawn or never went ahead) or "no_decision" (the insurer never decided).',
    'For a job the records can\'t close on their own, e.g. settled outside IRC. It can be reopened with reopen_job.',
    'Read back the job and the reason and get a clear yes before calling.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      job_number: { type: 'string', description: 'Job number, e.g. IRC1001.' },
      reason: { type: 'string', enum: CLOSE_REASONS },
    },
    required: ['job_number', 'reason'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  permission: 'jobs.change_stage',
  async run(args, ctx): Promise<McpToolResult> {
    if (!isCloseReason(args.reason)) return { text: `The reason must be one of: ${CLOSE_REASONS.join(', ')}.`, isError: true }
    const job = await jobFromArgs(args, ctx)
    if (isToolResult(job)) return job
    try {
      await closeJobs(db(ctx), ctx.tenantId, [{ jobId: job.id, reason: args.reason }])
      return {
        text: `Closed ${job.job_number}, ${job.property_address ?? 'no address'}, as ${CLOSED_LABELS[args.reason].toLowerCase()}.`,
        data: { job_number: job.job_number, closed_reason: args.reason },
      }
    } catch (err) {
      if (err instanceof CloseJobError) return { text: err.message, isError: true }
      throw err
    }
  },
}

export const reopenJobTool: McpTool = {
  name: 'reopen_job',
  title: 'Reopen job',
  description: [
    'Reopens a job that was closed by hand (close_job or the old-jobs clean-up): its phase is worked out from its records again.',
    'A job that closed on its own (everything paid, or the lapse time passed) reopens when something new happens on it.',
    'Read back the job and get a clear yes before calling.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { job_number: { type: 'string', description: 'Job number, e.g. IRC1001.' } },
    required: ['job_number'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  permission: 'jobs.change_stage',
  async run(args, ctx): Promise<McpToolResult> {
    const job = await jobFromArgs(args, ctx)
    if (isToolResult(job)) return job
    const { data } = await db(ctx).from('jobs').select('closed_by_hand').eq('tenant_id', ctx.tenantId).eq('id', job.id).maybeSingle()
    if (!(data as { closed_by_hand: string | null } | null)?.closed_by_hand) {
      return { text: `${job.job_number} wasn't closed by hand, so there's nothing to reopen.`, isError: true }
    }
    try {
      await reopenJob(db(ctx), ctx.tenantId, job.id)
      return { text: `Reopened ${job.job_number}, ${job.property_address ?? 'no address'}.`, data: { job_number: job.job_number } }
    } catch (err) {
      if (err instanceof CloseJobError) return { text: err.message, isError: true }
      throw err
    }
  },
}
