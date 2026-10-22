import type { McpTool, McpToolResult } from '@/lib/mcp/server'
import { spokenDate } from '@/lib/mcp/tools/work-orders'
import { listDroppedEmails, recoverDroppedEmail, type RecoveryResult } from '@/lib/communications/recover-dropped'

// Runs the one-off recovery of emails the auto job lodger dropped
// (lib/communications/recover-dropped.ts) in batches small enough for one
// request: Claude calls it again with next_cursor until done.

const DEFAULT_BATCH = 10
const MAX_BATCH = 20
/** Stop starting new emails after this long so the request finishes inside the route's limit */
const TIME_BUDGET_MS = 80_000

export const recoverDroppedEmails: McpTool = {
  name: 'recover_dropped_emails',
  title: 'Recover dropped emails',
  description: [
    'One-off clean-up: finds emails the auto job lodger dropped before 23 Oct 2026 (remittance advices, replies on existing jobs and the like) in Gmail and saves them to their jobs\' email history, with attachments.',
    'Works in batches: start with dry_run: true to see what it would do, then run for real, and keep calling with next_cursor until done is true.',
    'Emails already saved are skipped, so it is safe to run again. Tell the user about any saved email that couldn\'t be matched to a job (it may be a missed order — use find_order_emails / create_order_from_email).',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      dry_run: { type: 'boolean', description: 'Find the emails but save nothing. Default false.' },
      cursor: { type: 'string', description: 'next_cursor from the previous batch. Leave out to start from the beginning.' },
      batch_size: { type: 'number', description: `Emails per batch (default ${DEFAULT_BATCH}, max ${MAX_BATCH}).` },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const dryRun = args.dry_run === true
    const cursor = typeof args.cursor === 'string' && args.cursor.trim() ? args.cursor.trim() : null
    const batch = Math.min(MAX_BATCH, Math.max(1, Math.round(Number(args.batch_size) || DEFAULT_BATCH)))
    const started = Date.now()

    const { emails, remaining, lastAt } = await listDroppedEmails(ctx.supabase, ctx.tenantId, cursor, batch)
    const results: RecoveryResult[] = []
    let nextCursor = lastAt
    for (const email of emails) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        nextCursor = results.at(-1)?.at ?? cursor
        break
      }
      results.push(await recoverDroppedEmail(ctx.supabase, ctx.tenantId, email, dryRun))
    }
    const unprocessed = emails.length - results.length
    const left = remaining + unprocessed
    const done = left === 0

    const jobIds = [...new Set(results.map(r => r.jobId).filter((id): id is string => !!id))]
    const { data: jobs } = jobIds.length
      ? await ctx.supabase.from('jobs').select('id, job_number').eq('tenant_id', ctx.tenantId).in('id', jobIds)
      : { data: [] as { id: string; job_number: string }[] }
    const jobNumber = new Map((jobs ?? []).map(j => [j.id, j.job_number]))

    const count = (s: RecoveryResult['status']) => results.filter(r => r.status === s).length
    const line = (r: RecoveryResult) => {
      const where = r.jobId ? ` → ${jobNumber.get(r.jobId) ?? 'a job'}` : r.status === 'saved' ? ' → not matched to a job' : ''
      return `- ${spokenDate(r.at)}, ${r.from}: "${r.subject}" — ${r.status.replace('_', ' ')}${where}${r.detail ? ` (${r.detail})` : ''}`
    }
    const summary = dryRun
      ? `Dry run: ${count('would_save')} would be saved, ${count('already_saved')} already saved, ${count('not_found')} not found in Gmail, ${count('error')} errors.`
      : `${count('saved')} saved, ${count('already_saved')} already saved, ${count('not_found')} not found in Gmail, ${count('error')} errors.`
    const unmatched = results.filter(r => r.status === 'saved' && !r.jobId)

    return {
      text: [
        summary,
        ...results.map(line),
        ...(unmatched.length ? [`${unmatched.length} saved email${unmatched.length === 1 ? '' : 's'} couldn't be matched to a job — check whether any is a missed order.`] : []),
        done ? 'Done — no more dropped emails.' : `${left} more to go — call again with next_cursor.`,
      ].join('\n'),
      data: {
        dry_run: dryRun,
        done,
        remaining: left,
        next_cursor: done ? null : nextCursor,
        results: results.map(r => ({ ...r, job_number: r.jobId ? jobNumber.get(r.jobId) ?? null : null })),
      },
    }
  },
}
