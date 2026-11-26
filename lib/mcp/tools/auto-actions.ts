import type { SupabaseClient } from '@supabase/supabase-js'
import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { AutoActionError, listAutoActions, undoAutoAction } from '@/lib/automation/auto-bookings'
import { spokenSendAt } from '@/lib/mail/schedule-rules'

// Done for you by voice and chat (tech spec §23.19): what IRC did by itself
// from the office's own words (a trade's day put on the schedule from an email
// they sent), and undoing one — the same functions as the Calendar page.

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const db = (ctx: McpContext) => ctx.supabase as unknown as SupabaseClient

export const listDoneForYou: McpTool = {
  name: 'list_done_for_you',
  title: 'What IRC did by itself',
  description: [
    'What IRC did by itself from the office\'s own words, newest first — "what did IRC put in the schedule?", "what have you done for me this week?". Today: trades\' days put on the schedule because an email the office sent stated or agreed to them ("the painter will be there Tuesday", "yes, Thursday works"), each with the words it went on.',
    'days: how far back (default 14). Undo one with undo_done_for_you.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { days: { type: 'number', description: 'How many days back. Default 14.' } },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },

  async run(args, ctx): Promise<McpToolResult> {
    const days = Math.min(90, Math.max(1, Math.round(Number(args.days) || 14)))
    const rows = await listAutoActions(db(ctx), ctx.tenantId, { days })
    if (!rows.length) return { text: `Nothing done by itself in the last ${days} days.`, data: { actions: [] } }
    return {
      text: [`Done for you in the last ${days} days:`, ...rows.map(r =>
        `- ${spokenSendAt(r.created_at)}: ${r.summary}${r.evidence ? ` — you wrote "${r.evidence}"` : ''}${r.status === 'undone' ? ' (undone)' : ''}`)].join('\n'),
      data: { actions: rows.map(r => ({ id: r.id, job_number: r.job_number, summary: r.summary, evidence: r.evidence, status: r.status, at: r.created_at })) },
    }
  },
}

export const undoDoneForYou: McpTool = {
  name: 'undo_done_for_you',
  title: 'Undo something IRC did by itself',
  description: [
    'Undoes something IRC did by itself (list_done_for_you): a trade\'s day goes back to what it was, or off the schedule if it had none.',
    'reason, in the user\'s words, teaches IRC why it was wrong ("that was the homeowner\'s suggestion, not a booking") — ask for one briefly if they don\'t say. Read back what will be undone and get a yes first.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The id from list_done_for_you.' },
      reason: { type: 'string', description: 'Why it was wrong, in the user\'s words.' },
    },
    required: ['id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  permission: 'jobs.edit',

  async run(args, ctx): Promise<McpToolResult> {
    try {
      const undone = await undoAutoAction(db(ctx), ctx.tenantId, str(args.id), ctx.userId, str(args.reason) || undefined)
      return { text: `Undone: ${undone.summary}.${undone.before ? ' It\'s back to its earlier day.' : ' It\'s off the schedule.'}`, data: { id: undone.id, status: undone.status } }
    } catch (err) {
      if (err instanceof AutoActionError) return { text: err.message, isError: true }
      throw err
    }
  },
}
