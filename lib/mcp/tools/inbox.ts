import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { isToolResult, jobFromArgs } from '@/lib/mcp/tools/excess'
import { extractMessageParts, getFullMessage } from '@/lib/gmail/messages'
import { recordInboxMessage } from '@/lib/communications/inbound-email'
import { linkThreadToJob } from '@/lib/communications/thread-link'

// Filing emails on jobs by voice: saving an inbox email the app never
// recorded (attachments and all, matched to its job as the Gmail webhook
// does), and moving an email onto a job as "Link to job" in the unlinked
// inbox does.

const OWN_DOMAIN = 'insurancerepairco.com.au'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const GMAIL_ID_RE = /^[0-9a-zA-Z]{8,32}$/

async function jobNumberOf(ctx: McpContext, jobId: string | null): Promise<string | null> {
  if (!jobId) return null
  const { data } = await ctx.supabase.from('jobs').select('job_number').eq('tenant_id', ctx.tenantId).eq('id', jobId).maybeSingle()
  return data?.job_number ?? null
}

/** Puts an email (and the rest of its conversation) on a job — the unlinked inbox's "Link to job". */
async function linkToJob(ctx: McpContext, emailId: string, jobId: string): Promise<number> {
  const { data, error } = await ctx.supabase
    .from('communications')
    .update({ job_id: jobId, match_candidates: null } as never)
    .eq('tenant_id', ctx.tenantId).eq('id', emailId)
    .select('thread_id')
    .single()
  if (error) throw error
  const threadId = (data as { thread_id: string | null } | null)?.thread_id ?? null
  return linkThreadToJob(ctx.supabase, ctx.tenantId, threadId, jobId)
}

export const saveEmail: McpTool = {
  name: 'save_email',
  title: 'Save email to job',
  description: [
    'Saves an inbox email the app doesn\'t have yet (use find_order_emails to find it) to the job\'s email history, with its attachments —',
    'matched to its job automatically, or to job_number if given. If the app already has it, says where it is (and moves it to job_number if given).',
    'Confirm the email and job with the user first.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      message_id: { type: 'string', description: 'message_id from find_order_emails.' },
      job_number: { type: 'string', description: 'Put it on this job instead of matching automatically.' },
    },
    required: ['message_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  permission: 'orders.manage',

  async run(args, ctx): Promise<McpToolResult> {
    const messageId = typeof args.message_id === 'string' ? args.message_id.trim() : ''
    if (!GMAIL_ID_RE.test(messageId)) return { text: 'Email not found — use find_order_emails for its id.', isError: true }
    const wantJob = typeof args.job_number === 'string' && args.job_number.trim() ? await jobFromArgs(args, ctx) : null
    if (isToolResult(wantJob)) return wantJob

    const msg = await extractMessageParts(await getFullMessage(messageId))
    if (msg.fromEmail.toLowerCase().endsWith(`@${OWN_DOMAIN}`)) {
      return { text: 'That\'s an email we sent — those are recorded automatically.', isError: true }
    }

    // Already on the comms log?
    const { data: existing, error } = await ctx.supabase
      .from('communications').select('id, job_id')
      .eq('tenant_id', ctx.tenantId).eq('gmail_message_id', msg.gmailMessageId).limit(1)
    if (error) throw error
    const known = msg.gmailMessageId ? existing?.[0] : undefined
    if (known) {
      if (wantJob && known.job_id !== wantJob.id) {
        await linkToJob(ctx, known.id, wantJob.id)
        return { text: `That email was already saved; moved it to ${wantJob.job_number}.`, data: { email_id: known.id, job_number: wantJob.job_number } }
      }
      const jobNumber = await jobNumberOf(ctx, known.job_id)
      return {
        text: jobNumber ? `That email is already on ${jobNumber}.` : 'That email is already saved but not on a job — say which job to put it on.',
        data: { email_id: known.id, job_number: jobNumber },
      }
    }

    const { emailId, stored, link } = await recordInboxMessage(ctx.supabase, ctx.tenantId, messageId, msg)
    if (!link) return { text: 'The email could not be saved. Try again, or check the app.', isError: true }

    let jobId = link.job_id
    if (wantJob && jobId !== wantJob.id) {
      await linkToJob(ctx, emailId, wantJob.id)
      jobId = wantJob.id
    }
    const jobNumber = wantJob?.job_number ?? await jobNumberOf(ctx, jobId)
    const files = stored.length ? ` with ${stored.length} attachment${stored.length === 1 ? '' : 's'}` : ''
    return {
      text: jobNumber
        ? `Saved "${msg.subject}"${files} to ${jobNumber}.`
        : `Saved "${msg.subject}"${files}, but it couldn't be matched to a job — it's in the unlinked inbox. Say which job to put it on.`,
      data: { email_id: emailId, job_number: jobNumber, attachments: stored.map(a => a.filename) },
    }
  },
}

export const linkEmailToJob: McpTool = {
  name: 'link_email_to_job',
  title: 'Put email on job',
  description: 'Puts an email (from list_job_emails) and the rest of its conversation on a job — like "Link to job" in the unlinked inbox. Confirm the email and job with the user first.',
  inputSchema: {
    type: 'object',
    properties: {
      email_id: { type: 'string', description: 'email_id from list_job_emails.' },
      job_number: { type: 'string', description: 'Job number, e.g. IRC1001.' },
    },
    required: ['email_id', 'job_number'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  permission: 'orders.manage',

  async run(args, ctx): Promise<McpToolResult> {
    const emailId = typeof args.email_id === 'string' ? args.email_id.trim() : ''
    if (!UUID_RE.test(emailId)) return { text: 'Email not found — use list_job_emails for its id.', isError: true }
    const job = await jobFromArgs(args, ctx)
    if (isToolResult(job)) return job
    const { data: email, error } = await ctx.supabase
      .from('communications').select('id, subject').eq('tenant_id', ctx.tenantId).eq('id', emailId).maybeSingle()
    if (error) throw error
    if (!email) return { text: 'Email not found — use list_job_emails for its id.', isError: true }

    const others = await linkToJob(ctx, emailId, job.id)
    return {
      text: `Put "${email.subject ?? 'the email'}" on ${job.job_number}${others ? `, with ${others} other email${others === 1 ? '' : 's'} from the same conversation` : ''}.`,
      data: { email_id: emailId, job_number: job.job_number },
    }
  },
}
