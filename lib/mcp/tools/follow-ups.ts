import type { SupabaseClient } from '@supabase/supabase-js'
import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { CardError, listCards, withContext, type CardWithContext } from '@/lib/actions/cards'
import { cancelFollowUp, createFollowUp, parseFollowUpWhen, spokenDue, updateFollowUp } from '@/lib/actions/followups'
import { isToolResult, jobFromArgs } from '@/lib/mcp/tools/excess'

// Follow-ups by voice and chat — the Remind me button's own functions
// (lib/actions/followups.ts): set one ("remind me in a week to chase the
// roofer on IRC1042"), list what's coming up, move or cancel one. When it's
// due it comes onto the action cards with the chase drafted; nothing is sent
// by itself. Action cards also suggest set_follow_up as a step.

const MAX_LIST = 25
const ID_RE = /^[0-9a-f-]{36}$/i
const THREAD_ID_RE = /^[0-9a-f]+$/i

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const db = (ctx: McpContext) => ctx.supabase as unknown as SupabaseClient

const WHEN = 'When: a number of days ("7"), "2 weeks", "1 month", or a Perth date "2026-11-02" (it comes onto the list at 8am that day), or date and time "2026-11-02T14:00".'

function line(c: CardWithContext): string {
  const f = c.follow_up
  return `${c.due_at ? spokenDue(c.due_at) : 'no date'}: ${f?.note ?? c.title}${f?.who ? ` (with ${f.who})` : ''}${c.job ? ` — ${c.job.job_number}` : ''}`
}

const data = (c: CardWithContext) => ({
  follow_up_id: c.id, due: c.due_at, note: c.follow_up?.note ?? null, who: c.follow_up?.who ?? null, job_number: c.job?.job_number ?? null,
})

export const setFollowUp: McpTool = {
  name: 'set_follow_up',
  title: 'Set follow-up',
  description: [
    'Reminds the office to follow something up later — "remind me in a week to chase Ace Roofing for the quote on IRC1042".',
    'On the day it comes onto the action cards, where the AI checks whether it\'s still needed and drafts the chase (an email to the trade, a note) for the user to confirm. Nothing is sent by itself.',
    `${WHEN} note says what to follow up, in the user's words; who is the person or trade, if any.`,
    'Read back the date and what it\'s for, and get a yes first.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      note: { type: 'string', description: 'What to follow up, e.g. "Chase the roof quote — they said Friday".' },
      when: { type: 'string', description: 'Days ("7"), "2 weeks", "1 month", or a Perth date "2026-11-02" / date and time.' },
      who: { type: 'string', description: 'Who to follow up with, e.g. "Ace Roofing", "the insured", "Jo at Allianz".' },
      job_number: { type: 'string', description: 'The job it\'s about, e.g. IRC1001.' },
      conversation_id: { type: 'string', description: 'The email conversation it\'s about, if any — the AI reads it again on the day.' },
    },
    required: ['note', 'when'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  permission: 'actions.review',

  async run(args, ctx): Promise<McpToolResult> {
    const dueAt = parseFollowUpWhen(args.when)
    if (!dueAt) return { text: `When should it be? ${WHEN}`, isError: true }
    let job: { id: string; job_number: string } | null = null
    if (str(args.job_number)) {
      const found = await jobFromArgs(args, ctx)
      if (isToolResult(found)) return found
      job = found
    }
    const threadId = THREAD_ID_RE.test(str(args.conversation_id)) ? str(args.conversation_id) : null
    try {
      const card = await createFollowUp(db(ctx), ctx.tenantId, ctx.userId || null, { jobId: job?.id ?? null, note: str(args.note), who: str(args.who) || null, dueAt, threadId })
      return {
        text: `Follow-up set for ${spokenDue(dueAt)}${job ? ` on ${job.job_number}` : ''}: ${card.follow_up?.note}. It'll come onto the action cards then.`,
        data: { follow_up_id: card.id, due: card.due_at, job_number: job?.job_number ?? null },
      }
    } catch (err) {
      if (err instanceof CardError) return { text: err.message, isError: true }
      throw err
    }
  },
}

export const listFollowUps: McpTool = {
  name: 'list_follow_ups',
  title: 'List follow-ups',
  description: 'The follow-ups waiting for their date (soonest first), optionally for one job: when, what, who. Once due they\'re on the action cards instead (list_action_cards).',
  inputSchema: {
    type: 'object',
    properties: { job_number: { type: 'string', description: 'Only this job\'s follow-ups.' } },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  permission: 'mail.view',

  async run(args, ctx): Promise<McpToolResult> {
    let jobId: string | null = null
    if (str(args.job_number)) {
      const job = await jobFromArgs(args, ctx)
      if (isToolResult(job)) return job
      jobId = job.id
    }
    const cards = await withContext(db(ctx), ctx.tenantId, await listCards(db(ctx), ctx.tenantId, 'upcoming', { limit: MAX_LIST, jobId }))
    if (!cards.length) return { text: jobId ? 'No follow-ups set on that job.' : 'No follow-ups coming up.', data: { follow_ups: [] } }
    return {
      text: [`${cards.length} follow-up${cards.length === 1 ? '' : 's'} coming up:`, ...cards.map((c, i) => `${i + 1}. ${line(c)}`)].join('\n'),
      data: { follow_ups: cards.map(data) },
    }
  },
}

export const changeFollowUp: McpTool = {
  name: 'change_follow_up',
  title: 'Change follow-up',
  description: [
    'Moves a follow-up from list_follow_ups to another date, changes what it says, or cancels it (cancel: true).',
    `${WHEN} Read back the change and get a yes first.`,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      follow_up_id: { type: 'string', description: 'follow_up_id from list_follow_ups.' },
      when: { type: 'string' },
      note: { type: 'string' },
      who: { type: 'string' },
      cancel: { type: 'boolean', description: 'Cancel it instead.' },
    },
    required: ['follow_up_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  permission: 'actions.review',

  async run(args, ctx): Promise<McpToolResult> {
    const id = str(args.follow_up_id)
    if (!ID_RE.test(id)) return { text: 'Which follow-up? Use list_follow_ups for its id.', isError: true }
    if (args.cancel === true) {
      return (await cancelFollowUp(db(ctx), ctx.tenantId, id, ctx.userId))
        ? { text: 'Follow-up cancelled.' }
        : { text: 'That follow-up isn\'t waiting any more — it may already be on the action cards.', isError: true }
    }
    const changes: { dueAt?: string; note?: string; who?: string | null } = {}
    if (args.when !== undefined) {
      const dueAt = parseFollowUpWhen(args.when)
      if (!dueAt) return { text: `When should it be? ${WHEN}`, isError: true }
      changes.dueAt = dueAt
    }
    if (typeof args.note === 'string') changes.note = args.note
    if (typeof args.who === 'string') changes.who = args.who
    try {
      const card = (await withContext(db(ctx), ctx.tenantId, [await updateFollowUp(db(ctx), ctx.tenantId, id, changes)]))[0]
      return { text: `Follow-up now ${line(card)}.`, data: data(card) }
    } catch (err) {
      if (err instanceof CardError) return { text: err.message, isError: true }
      throw err
    }
  },
}
