import type { SupabaseClient } from '@supabase/supabase-js'
import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { cardForThread, getCard, listCards, skipCard, snoozeCard, withContext, type CardView, type CardWithContext } from '@/lib/actions/cards'
import { CardError, confirmCard, type StepChoice } from '@/lib/actions/confirm'
import { parseSendAt, spokenSendAt } from '@/lib/mail/schedule-rules'
import { spokenDate } from '@/lib/mcp/tools/work-orders'

// Action cards by voice (and in the assistant chat) — the Action cards view's
// own functions (lib/actions): what needs doing, one card's steps and draft
// email, Do the steps, Skip and Snooze. Each step still runs through
// callTool as the user, with its own permission, approval and log entry.

const DEFAULT_LIST = 10
const MAX_LIST = 25
const VIEWS: CardView[] = ['pending', 'snoozed', 'done']
const CARD_ID_RE = /^[0-9a-f-]{36}$/i
/** Fields a step's changes may set — confirmCard keeps only the ones its tool allows */
const CHANGE_FIELDS = ['to', 'cc', 'bcc', 'subject', 'body', 'send_at', 'note', 'job_number', 'filing'] as const

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const db = (ctx: McpContext) => ctx.supabase as unknown as SupabaseClient

const STATE: Record<string, string> = {
  queued: 'still being read',
  generating: 'still being read',
  running: 'steps running now',
  failed: 'stopped — a step failed',
  snoozed: 'snoozed',
  done: 'done',
  skipped: 'skipped',
  no_action: 'nothing needed',
}

const priorityWord = (p: number | null) => ((p ?? 50) >= 90 ? 'urgent' : (p ?? 50) <= 20 ? 'low' : null)

function cardLine(c: CardWithContext, i: number): string {
  const about = [c.job?.job_number, c.conversation ? `${c.conversation.from ?? 'unknown'}: "${c.conversation.subject || '(no subject)'}"` : null].filter(Boolean).join(', ')
  const flags = [priorityWord(c.priority), c.status !== 'pending' ? STATE[c.status] : null, c.status === 'snoozed' && c.snoozed_until ? `until ${spokenSendAt(c.snoozed_until)}` : null, c.outcome].filter(Boolean)
  const steps = c.steps.length ? ` Steps: ${c.steps.map(s => s.summary).join('; ')}.` : ''
  return `${i + 1}. ${c.title}${about ? ` (${about})` : ''}${flags.length ? ` [${flags.join(', ')}]` : ''}.${steps}`
}

const cardData = (c: CardWithContext) => ({
  card_id: c.id,
  title: c.title,
  status: c.status,
  priority: priorityWord(c.priority) ?? 'normal',
  job_number: c.job?.job_number ?? null,
  conversation_id: c.source === 'email' ? c.source_ref : null,
  from: c.conversation?.from ?? null,
  subject: c.conversation?.subject ?? null,
  summary: c.description,
  steps: c.steps.map(s => ({ step_id: s.id, summary: s.summary, kind: s.kind, status: s.status ?? 'to do' })),
  snoozed_until: c.snoozed_until,
  outcome: c.outcome,
  error: c.error_log,
})

async function findCard(args: Record<string, unknown>, ctx: McpContext): Promise<CardWithContext | McpToolResult> {
  const id = str(args.card_id)
  const conversation = str(args.conversation_id)
  const card = id
    ? CARD_ID_RE.test(id) ? await getCard(db(ctx), ctx.tenantId, id) : null
    : conversation ? await cardForThread(db(ctx), ctx.tenantId, conversation) : undefined
  if (card === undefined) return { text: 'Which card? Give card_id from list_action_cards (or conversation_id).', isError: true }
  if (!card) return { text: id ? 'Card not found — use list_action_cards for its id.' : 'That conversation has no action card.', isError: true }
  return (await withContext(db(ctx), ctx.tenantId, [card]))[0]
}

const isResult = (v: unknown): v is McpToolResult => !!v && typeof v === 'object' && 'text' in v && !('steps' in v)

export const listActionCards: McpTool = {
  name: 'list_action_cards',
  title: 'List action cards',
  description: [
    'The action cards — what needs doing, most urgent first, as on the dashboard. The AI makes one for each incoming email from the email and its job file, with suggested steps (a reply, filing it on a job, a job note…) that only run when confirmed.',
    'view: pending (default — needs action), snoozed or done. Use read_action_card for a card\'s full steps and draft email, confirm_action_card to do them, dismiss_action_card to skip or snooze.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      view: { type: 'string', enum: VIEWS },
      limit: { type: 'number', description: `How many (default ${DEFAULT_LIST}, max ${MAX_LIST}).` },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  permission: 'mail.view',

  async run(args, ctx): Promise<McpToolResult> {
    const view = VIEWS.includes(args.view as CardView) ? (args.view as CardView) : 'pending'
    const limit = Math.min(MAX_LIST, Math.max(1, Math.round(Number(args.limit) || DEFAULT_LIST)))
    const all = await listCards(db(ctx), ctx.tenantId, view)
    const cards = await withContext(db(ctx), ctx.tenantId, all.slice(0, limit))
    if (!cards.length) {
      return { text: view === 'pending' ? 'No action cards need you right now.' : `No ${view} action cards.`, data: { view, cards: [] } }
    }
    const heading = view === 'pending'
      ? `${all.length} action card${all.length === 1 ? '' : 's'} need${all.length === 1 ? 's' : ''} you${all.length > cards.length ? ` — the first ${cards.length}` : ''}:`
      : `${view === 'snoozed' ? 'Snoozed' : 'Done'} action cards:`
    return { text: [heading, ...cards.map(cardLine)].join('\n'), data: { view, total: all.length, cards: cards.map(cardData) } }
  },
}

export const readActionCard: McpTool = {
  name: 'read_action_card',
  title: 'Read action card',
  description: [
    'One action card in full: what the email says, why these steps, and each step exactly as it would run — including the drafted email (to, subject, body).',
    'Give card_id from list_action_cards, or conversation_id from list_mailbox for that conversation\'s card. Read this before confirm_action_card so you can read the steps back.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      card_id: { type: 'string', description: 'card_id from list_action_cards.' },
      conversation_id: { type: 'string', description: 'Or the conversation it\'s about.' },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  permission: 'mail.view',

  async run(args, ctx): Promise<McpToolResult> {
    const card = await findCard(args, ctx)
    if (isResult(card)) return card
    const stepLines = card.steps.map((s, i) => {
      const a = s.args
      const lines = [`Step ${i + 1}${s.status ? ` (${s.status})` : ''}: ${s.summary}.`]
      if (s.tool === 'send_email') {
        if (str(a.to)) lines.push(`To: ${str(a.to)}${str(a.cc) ? `, cc ${str(a.cc)}` : ''}`)
        if (str(a.subject)) lines.push(`Subject: ${str(a.subject)}`)
        if (str(a.body)) lines.push(`Body:\n${str(a.body)}`)
      } else if (s.tool === 'add_job_note' && str(a.note)) {
        lines.push(`Note: ${str(a.note)}`)
      }
      if (s.result) lines.push(`Result: ${s.result}`)
      return lines.join('\n')
    })
    return {
      text: [
        `${card.title}${card.job ? ` — ${card.job.job_number}` : ''}${card.status !== 'pending' ? ` [${STATE[card.status]}]` : ''}.`,
        card.conversation ? `From ${card.conversation.from ?? 'unknown'}, "${card.conversation.subject || '(no subject)'}"${card.conversation.last_message_at ? `, ${spokenDate(card.conversation.last_message_at)}` : ''}.` : '',
        card.description ?? '',
        card.reasoning ? `Why: ${card.reasoning}` : '',
        card.error_log ? `Stopped: ${card.error_log}` : '',
        ...(stepLines.length ? ['', ...stepLines] : ['No steps suggested.']),
      ].filter(Boolean).join('\n'),
      data: { ...cardData(card), reasoning: card.reasoning, steps: card.steps.map(s => ({ step_id: s.id, tool: s.tool, summary: s.summary, args: s.args, status: s.status ?? 'to do', result: s.result ?? null })) },
    }
  },
}

export const confirmActionCard: McpTool = {
  name: 'confirm_action_card',
  title: 'Do action card steps',
  description: [
    'Does an action card\'s steps — the dashboard\'s "Do steps" button. Steps run in order as the user (each with its own permission; some may go for approval instead), and the first failure stops the rest.',
    'step_ids picks which steps (default: every step not done yet). changes edits a step first: for an email to, cc, bcc, subject, body (plain text) or send_at (Perth time); for a note, note; for filing, job_number or filing.',
    'ONLY call after reading the steps back — for an email, who it goes to and what it says — and getting a clear yes.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      card_id: { type: 'string', description: 'card_id from list_action_cards.' },
      step_ids: { type: 'array', items: { type: 'string' }, description: 'step_id values to do (default: all not done yet).' },
      changes: {
        type: 'array',
        description: 'Edits to steps before they run.',
        items: {
          type: 'object',
          properties: {
            step_id: { type: 'string' },
            ...Object.fromEntries(CHANGE_FIELDS.map(f => [f, { type: 'string' }])),
          },
          required: ['step_id'],
          additionalProperties: false,
        },
      },
    },
    required: ['card_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  permission: 'actions.review',

  async run(args, ctx): Promise<McpToolResult> {
    const card = await findCard({ card_id: args.card_id }, ctx)
    if (isResult(card)) return card
    if (!card.steps.length) return { text: 'This card has no steps to do — skip it with dismiss_action_card if it\'s dealt with.', isError: true }
    const ids = Array.isArray(args.step_ids) && args.step_ids.length
      ? args.step_ids.map(str)
      : card.steps.filter(s => s.status !== 'done' && s.status !== 'skipped').map(s => s.id)
    const unknown = ids.filter(id => !card.steps.some(s => s.id === id))
    if (unknown.length) return { text: 'Some of those steps aren\'t on this card — use read_action_card for the step ids.', isError: true }
    const changes = new Map<string, Record<string, unknown>>()
    for (const c of Array.isArray(args.changes) ? args.changes : []) {
      if (!c || typeof c !== 'object') continue
      const { step_id, ...fields } = c as Record<string, unknown>
      if (typeof step_id === 'string') changes.set(step_id, Object.fromEntries(Object.entries(fields).filter(([k, v]) => (CHANGE_FIELDS as readonly string[]).includes(k) && typeof v === 'string')))
    }
    const choices: StepChoice[] = ids.map(id => ({ id, args: changes.get(id) }))
    try {
      const done = await confirmCard(ctx.tenantId, ctx.userId, card.id, choices, { db: db(ctx), via: ctx.via === 'chat' ? 'chat' : 'voice', voiceKeyId: ctx.voiceKeyId })
      const ran = done.steps.filter(s => ids.includes(s.id))
      const lines = ran.map(s => `- ${s.summary}: ${s.status === 'done' ? 'done' : s.status === 'waiting' ? 'sent for approval' : s.status === 'failed' ? `failed — ${s.result ?? 'no reason given'}` : 'not run'}`)
      return {
        text: [done.status === 'failed' ? `Stopped: ${done.error_log}` : `${done.outcome}.`, ...lines].join('\n'),
        data: { card_id: done.id, status: done.status, outcome: done.outcome, steps: ran.map(s => ({ step_id: s.id, summary: s.summary, status: s.status, result: s.result ?? null })) },
        isError: done.status === 'failed',
      }
    } catch (err) {
      if (err instanceof CardError) return { text: err.message, isError: true }
      throw err
    }
  },
}

export const dismissActionCard: McpTool = {
  name: 'dismiss_action_card',
  title: 'Skip or snooze action card',
  description: [
    'Skips an action card (nothing to do, or done another way — it moves to Done) or snoozes it until a time (Perth time, e.g. "tomorrow 8am"; it comes back to needs action then).',
    'Confirm which card first.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      card_id: { type: 'string', description: 'card_id from list_action_cards.' },
      action: { type: 'string', enum: ['skip', 'snooze'] },
      snooze_until: { type: 'string', description: 'For snooze: when it comes back, Perth time.' },
    },
    required: ['card_id', 'action'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  permission: 'actions.review',

  async run(args, ctx): Promise<McpToolResult> {
    const card = await findCard({ card_id: args.card_id }, ctx)
    if (isResult(card)) return card
    if (args.action === 'skip') {
      if (!(await skipCard(db(ctx), ctx.tenantId, card.id, ctx.userId))) return { text: `That card is ${STATE[card.status] ?? card.status} — it can't be skipped now.`, isError: true }
      return { text: `Skipped "${card.title}".`, data: { card_id: card.id, status: 'skipped' } }
    }
    if (args.action !== 'snooze') return { text: 'action must be skip or snooze.', isError: true }
    const until = parseSendAt(str(args.snooze_until))
    if (!until || new Date(until).getTime() <= Date.now()) return { text: 'Snooze until when? Give a time in the future, e.g. "tomorrow 8am".', isError: true }
    if (!(await snoozeCard(db(ctx), ctx.tenantId, card.id, until))) return { text: `That card is ${STATE[card.status] ?? card.status} — it can't be snoozed now.`, isError: true }
    return { text: `Snoozed "${card.title}" until ${spokenSendAt(until)}.`, data: { card_id: card.id, status: 'snoozed', until } }
  },
}
