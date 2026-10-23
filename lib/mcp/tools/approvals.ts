import type { McpTool, McpToolResult } from '@/lib/mcp/server'
import { ApprovalError, decideApproval, listApprovals, type ApprovalDecision } from '@/lib/approvals/service'

// The approval queue by voice: what's waiting, and approving / rejecting /
// cancelling a request. The same lib/approvals functions as the dashboard's
// Approvals panel, which also check who may decide.

const TIME_ZONE = 'Australia/Perth'
const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { timeZone: TIME_ZONE, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export const listApprovalsTool: McpTool = {
  name: 'list_approvals',
  title: 'List approvals',
  description: [
    'Requests waiting for approval — things a user with "needs approval" asked to do (send documents, a signing request, an email reply…) — that the user can approve, reject or cancel.',
    'With include_recent, also what was decided in the last 14 days and what happened.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { include_recent: { type: 'boolean', description: 'Also list recently decided requests.' } },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const all = await listApprovals(ctx.tenantId, ctx.userId, { status: args.include_recent ? 'all' : 'pending' }, ctx.supabase)
    const pending = all.filter(a => a.status === 'pending')
    const decided = all.filter(a => a.status !== 'pending')
    const lines = [
      pending.length ? `${pending.length} waiting for approval:` : 'Nothing is waiting for approval.',
      ...pending.map(a => `- ${a.summary} — asked by ${a.requestedBy.name ?? 'someone'}${a.requestedVia === 'voice' ? ' by voice' : ''}, ${when(a.createdAt)}${a.canDecide ? '' : ' (yours; you can cancel it)'}`),
      ...(args.include_recent && decided.length ? ['', 'Recently decided:', ...decided.map(a => `- ${a.summary}: ${a.status}${a.decidedBy?.name ? ` by ${a.decidedBy.name}` : ''}${a.result && a.status === 'failed' ? ` — ${a.result}` : ''}`)] : []),
    ]
    return {
      text: lines.join('\n'),
      data: {
        approvals: all.map(a => ({
          approval_id: a.id, summary: a.summary, status: a.status, action: a.action,
          requested_by: a.requestedBy.name, requested_via: a.requestedVia, created_at: a.createdAt,
          can_decide: a.canDecide, can_cancel: a.canCancel, result: a.result,
        })),
      },
    }
  },
}

const DECISIONS: ApprovalDecision[] = ['approve', 'reject', 'cancel']

export const decideApprovalTool: McpTool = {
  name: 'decide_approval',
  title: 'Decide approval',
  description: [
    'Approves, rejects or cancels a waiting request (approval_id from list_approvals). Approving does the action straight away — e.g. sends the email — exactly as if the person who asked had been allowed to.',
    'Read back what will happen and get a clear yes first. Cancel is for the user\'s own requests.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      approval_id: { type: 'string', description: 'From list_approvals.' },
      decision: { type: 'string', enum: DECISIONS },
      note: { type: 'string', description: 'Optional reason, e.g. why it was rejected.' },
    },
    required: ['approval_id', 'decision'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  // decideApproval checks the user is allowed to do the requested action
  checksOwnPermission: true,

  async run(args, ctx): Promise<McpToolResult> {
    const id = typeof args.approval_id === 'string' ? args.approval_id.trim() : ''
    const decision = args.decision as ApprovalDecision
    if (!id) return { text: 'Which request? Use list_approvals to find it.', isError: true }
    if (!DECISIONS.includes(decision)) return { text: 'Decision must be approve, reject or cancel.', isError: true }
    try {
      const out = await decideApproval({
        tenantId: ctx.tenantId, userId: ctx.userId, id, decision,
        note: typeof args.note === 'string' ? args.note : null, service: ctx.supabase,
      })
      const text = out.status === 'approved' ? `Approved and done: ${out.summary}.${out.result ? ` ${out.result}` : ''}`
        : out.status === 'failed' ? `Approved, but it didn't go through: ${out.result}. The request is marked failed; nothing was retried.`
        : out.status === 'rejected' ? `Rejected: ${out.summary}.`
        : `Cancelled: ${out.summary}.`
      return { text, data: { approval_id: id, status: out.status, result: out.result }, isError: out.status === 'failed' }
    } catch (err) {
      if (err instanceof ApprovalError) return { text: err.message, isError: true }
      throw err
    }
  },
}
