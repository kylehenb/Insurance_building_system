import type { SupabaseClient } from '@supabase/supabase-js'
import type { McpContext, McpTool, McpToolResult } from '@/lib/mcp/server'
import { CATEGORIES, cardForThread, cardsForThreads, getCard, isCategory, listCards, skipCard, starThread, withContext, type CardView, type CardWithContext } from '@/lib/actions/cards'
import { CardError, confirmCard, type StepChoice } from '@/lib/actions/confirm'
import { spokenDate } from '@/lib/mcp/tools/work-orders'
import { messageText } from '@/lib/mail/message'

// Action cards by voice (and in the assistant chat) — the Action cards view's
// own functions (lib/actions): what needs doing (the starred list, by star),
// one card's steps and draft email, Do the steps, Skip, and starring an email. Each step still
// runs through callTool as the user, with its own permission, approval and
// log entry.

const DEFAULT_LIST = 10
const MAX_LIST = 25
const VIEWS: CardView[] = ['pending', 'done']
const categoryLabel = (key: string) => CATEGORIES.find(c => c.key === key)?.label ?? key
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
  done: 'done',
  skipped: 'skipped',
  no_action: 'nothing needed',
}

const priorityWord = (p: number | null) => ((p ?? 50) >= 90 ? 'urgent' : (p ?? 50) <= 20 ? 'low' : null)

function cardLine(c: CardWithContext, i: number): string {
  const about = [c.job?.job_number, c.conversation ? `${c.conversation.from ?? 'unknown'}: "${c.conversation.subject || '(no subject)'}"` : null].filter(Boolean).join(', ')
  const flags = [categoryLabel(c.category), priorityWord(c.priority), c.status !== 'pending' ? STATE[c.status] : null, c.outcome].filter(Boolean)
  const steps = c.steps.length ? ` Steps: ${c.steps.map(s => s.summary).join('; ')}.` : ''
  return `${i + 1}. ${c.title}${about ? ` (${about})` : ''}${flags.length ? ` [${flags.join(', ')}]` : ''}.${steps}`
}

const cardData = (c: CardWithContext) => ({
  card_id: c.id,
  title: c.title,
  status: c.status,
  category: c.category,
  category_label: categoryLabel(c.category),
  starred_by_user: !!c.starred_by,
  priority: priorityWord(c.priority) ?? 'normal',
  job_number: c.job?.job_number ?? null,
  conversation_id: c.source === 'email' ? c.source_ref : null,
  from: c.conversation?.from ?? null,
  subject: c.conversation?.subject ?? null,
  summary: c.description,
  steps: c.steps.map(s => ({ step_id: s.id, summary: s.summary, kind: s.kind, status: s.status ?? 'to do' })),
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
    'The action cards — the to-do list of starred emails, most urgent first, as on the dashboard. The AI makes one for each incoming email that needs doing (from the email and its job file, with suggested steps — a reply, filing it on a job, a job note… — that only run when confirmed), and the user stars others themselves.',
    'Each has a category (its star): Invoices to pay (invoice), Attend and Submit (attend_submit — sites to attend, reports or quotes to submit), Everything else (other). category filters to one.',
    'view: pending (default — needs action) or done. Use read_action_card for a card\'s full steps and draft email, confirm_action_card to do them, skip_action_card when it\'s dealt with.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      view: { type: 'string', enum: VIEWS },
      category: { type: 'string', enum: CATEGORIES.map(c => c.key), description: 'Only this star.' },
      limit: { type: 'number', description: `How many (default ${DEFAULT_LIST}, max ${MAX_LIST}).` },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  permission: 'mail.view',

  async run(args, ctx): Promise<McpToolResult> {
    const view = VIEWS.includes(args.view as CardView) ? (args.view as CardView) : 'pending'
    const limit = Math.min(MAX_LIST, Math.max(1, Math.round(Number(args.limit) || DEFAULT_LIST)))
    const category = isCategory(args.category) ? args.category : null
    const all = await listCards(db(ctx), ctx.tenantId, view, { category })
    const cards = await withContext(db(ctx), ctx.tenantId, all.slice(0, limit))
    const what = category ? `${categoryLabel(category)} card` : 'action card'
    if (!cards.length) {
      return { text: view === 'pending' ? `No ${what}s need you right now.` : `No done ${what}s.`, data: { view, category, cards: [] } }
    }
    const heading = view === 'pending'
      ? `${all.length} ${what}${all.length === 1 ? '' : 's'} need${all.length === 1 ? 's' : ''} you${all.length > cards.length ? ` — the first ${cards.length}` : ''}:`
      : `Done ${what}s:`
    return { text: [heading, ...cards.map(cardLine)].join('\n'), data: { view, category, total: all.length, cards: cards.map(cardData) } }
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
      if (s.tool === 'send_email' && s.draft) {
        // Edited in the app's composer: that draft is what will go
        const d = s.draft
        lines.push(`Edited in the app. To: ${d.to || 'no one yet'}${d.cc ? `, cc ${d.cc}` : ''}`, `Subject: ${d.subject || '(no subject)'}`, `Body:\n${messageText({ text: '', html: d.html })}`)
      } else if (s.tool === 'send_email') {
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
        `${card.title}${card.job ? ` — ${card.job.job_number}` : ''} [${categoryLabel(card.category)}${card.status !== 'pending' ? `, ${STATE[card.status]}` : ''}].`,
        card.conversation ? `From ${card.conversation.from ?? 'unknown'}, "${card.conversation.subject || '(no subject)'}"${card.conversation.last_message_at ? `, ${spokenDate(card.conversation.last_message_at)}` : ''}.` : '',
        card.description ?? '',
        card.reasoning ? `Why: ${card.reasoning}` : '',
        card.error_log ? `Stopped: ${card.error_log}` : '',
        ...(stepLines.length ? ['', ...stepLines] : ['No steps suggested.']),
      ].filter(Boolean).join('\n'),
      data: { ...cardData(card), reasoning: card.reasoning, steps: card.steps.map(s => ({ step_id: s.id, tool: s.tool, summary: s.summary, args: s.args, edited_email: s.draft ? { to: s.draft.to, cc: s.draft.cc, subject: s.draft.subject } : null, status: s.status ?? 'to do', result: s.result ?? null })) },
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
    if (!card.steps.length) return { text: 'This card has no steps to do — use skip_action_card once it\'s dealt with.', isError: true }
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

export const skipActionCard: McpTool = {
  name: 'skip_action_card',
  title: 'Skip action card',
  description: [
    'Takes a card off the to-do list (its star comes off): nothing to do, or done another way. It moves to Done.',
    'Confirm which card first.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { card_id: { type: 'string', description: 'card_id from list_action_cards.' } },
    required: ['card_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  permission: 'actions.review',

  async run(args, ctx): Promise<McpToolResult> {
    const card = await findCard({ card_id: args.card_id }, ctx)
    if (isResult(card)) return card
    if (!(await skipCard(db(ctx), ctx.tenantId, card.id, ctx.userId))) return { text: `That card is ${STATE[card.status] ?? card.status} — it can't be skipped now.`, isError: true }
    return { text: `Skipped "${card.title}".`, data: { card_id: card.id, status: 'skipped' } }
  },
}

const THREAD_ID_RE = /^[0-9a-f]+$/i
const MAX_STAR = 25

export const starEmail: McpTool = {
  name: 'star_email',
  title: 'Star email',
  description: [
    'Stars conversations from list_mailbox — puts them on the to-do list (the action cards) under a star — or changes their star, or takes it off, as the star button on the Mail page does.',
    'star: invoice (Invoices to pay), attend_submit (Attend and Submit — a site to attend, or a report or quote to submit), other (Everything else), or none to take the star off (it comes off the list).',
    'A star the user sets stays until they take it off, even after a reply. A newly starred email gets a card the AI fills in with a summary and suggested steps.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      conversation_ids: { type: 'array', items: { type: 'string' }, description: 'conversation_id values from list_mailbox.' },
      star: { type: 'string', enum: [...CATEGORIES.map(c => c.key), 'none'] },
    },
    required: ['conversation_ids', 'star'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  permission: 'actions.review',

  async run(args, ctx): Promise<McpToolResult> {
    const star = args.star === 'none' ? null : isCategory(args.star) ? args.star : undefined
    if (star === undefined) return { text: 'Which star? invoice, attend_submit, other, or none to take it off.', isError: true }
    const ids = Array.isArray(args.conversation_ids)
      ? [...new Set(args.conversation_ids.map(str).filter(id => THREAD_ID_RE.test(id)))]
      : []
    if (!ids.length) return { text: 'Which conversations? Use list_mailbox for their ids.', isError: true }
    if (ids.length > MAX_STAR) return { text: `At most ${MAX_STAR} at a time.`, isError: true }

    const before = await cardsForThreads(db(ctx), ctx.tenantId, ids)
    const results = []
    for (const id of ids) {
      if (!star && !before[id]) continue
      const out = await starThread(db(ctx), ctx.tenantId, id, star, ctx.userId)
      results.push({ conversation_id: id, title: out?.title ?? before[id]?.title ?? null, star: out?.category ?? null })
    }
    const n = results.length
    const what = (k: number) => `${k} email${k === 1 ? '' : 's'}`
    if (!star) {
      return {
        text: n ? `Took the star off ${what(n)}.` : 'None of those were starred.',
        data: { unstarred: results.map(r => r.conversation_id) },
      }
    }
    return {
      text: `Starred ${what(n)} as ${categoryLabel(star)}${n === 1 && results[0].title ? ` ("${results[0].title}")` : ''}.`,
      data: { star, starred: results },
    }
  },
}
