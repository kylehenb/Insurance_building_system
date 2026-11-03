import { randomUUID } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { McpContext, McpTool } from '@/lib/mcp/server'
import { MCP_TOOLS } from '@/lib/mcp/tools'
import { getJobSummary } from '@/lib/mcp/tools/jobs'
import { readConversation } from '@/lib/mcp/tools/mailbox'
import { getThreadDetail } from '@/lib/mail/list'
import { getMailbox, mailDb } from '@/lib/mail/sync'
import type { Situation } from '@/lib/learning/events'
import { bringForward, waitBrief } from './waits'
import { CATEGORIES, CardError, cardActor, claimQueued, getCard, isCategory, PRIORITY, queueEmailCard, type ActionCard, type CardStep, type StepKind } from './cards'
import { cardLearning, cardSituation, recordCardInstruction } from './learning'
import { orderUpdateBrief } from '@/lib/insurer-orders/order-update'
import { trackAi } from '@/lib/health/ai-usage'

// Making an action card: Claude (Haiku) reads the conversation and the whole
// job file, checks what it needs with the read-only tools, and proposes the
// next steps by calling the action tools — which are NOT run here, only
// recorded on the card for the user to confirm (lib/actions/confirm.ts runs
// them through the same callTool as the assistant). It reads what the office
// did in the most alike past cards, and the lessons from them, first
// (lib/actions/learning.ts, tech spec §24).

export const CARD_MODEL = process.env.AI_CARD_MODEL || 'claude-haiku-5-5'

/** Model calls per card before it has to finish */
const MAX_STEPS = 10
const MAX_PROPOSED_STEPS = 5
const OWN_DOMAIN = 'insurancerepairco.com.au'

/** Tools a card never uses: approvals, the activity log, one-off clean-up, older ways of replying and filing, and the cards themselves */
const LEFT_OUT = new Set([
  'list_approvals', 'decide_approval', 'list_activity', 'recover_dropped_emails',
  'reply_to_email', 'save_email', 'link_email_to_job',
  'list_action_cards', 'read_action_card', 'confirm_action_card', 'skip_action_card', 'update_action_card', 'star_email', 'change_follow_up',
])

/**
 * Record-keeping the system does by itself, so the AI doesn't offer it as a
 * step: every email is already in the job's Comms feed (the ledger), and a
 * conversation the AI can place on a job is filed there automatically. Offered
 * only when the office asks for it in their instructions — and a job note for
 * an appointment check-in, where the office fills in what happened.
 */
const RECORD_KEEPING = new Set(['add_job_note', 'file_conversation'])

/** The tools offered while making a card */
export function cardTools(tools: McpTool[], source: ActionCard['source'], instructed: boolean): McpTool[] {
  return tools.filter(t => !LEFT_OUT.has(t.name)
    && (instructed || !RECORD_KEEPING.has(t.name) || (source === 'appointment' && t.name === 'add_job_note')))
}

/** A tool a card can carry as a step: an action (not a read), and not one cards leave out */
export const isStepTool = (tool: McpTool) => !tool.annotations.readOnlyHint && !LEFT_OUT.has(tool.name)

const FINISH: Anthropic.Beta.BetaTool = {
  name: 'finish_card',
  description: 'Finish the card. Call this once, last, after proposing any steps.',
  input_schema: {
    type: 'object',
    properties: {
      needs_action: { type: 'boolean', description: 'false when nothing needs doing (a notification, newsletter, FYI or a thank-you).' },
      title: { type: 'string', description: 'What to do, in a few words, e.g. "Reply to Casey — confirm Thursday access". For no action: what the email is.' },
      summary: { type: 'string', description: 'Two or three plain sentences: what the email says and where the job stands.' },
      reasoning: { type: 'string', description: 'Why these steps, briefly — what in the job file or emails led to them.' },
      priority: { type: 'string', enum: ['high', 'normal', 'low'], description: 'high: urgent or a deadline (make safe, insurer chasing, SLA). low: can wait.' },
      category: {
        type: 'string',
        enum: CATEGORIES.map(c => c.key),
        description: 'invoice: a bill or invoice IRC has to pay (a trade, supplier or subcontractor invoice). attend_submit: a job to attend (inspection, make safe, site visit) or a report or quote to finish and submit after attending. other: everything else.',
      },
      job_number: { type: 'string', description: 'The job this is about, when the conversation is not on a job yet and you are sure which job it is (the job number, claim number or address match). The conversation is filed on it automatically. Leave out if unsure.' },
      admin: { type: 'boolean', description: 'true when the conversation is not on a job and is not job related at all (the business\'s own bills, accounts, subscriptions, notices): it is filed as admin automatically.' },
      chase_sooner: {
        type: 'array',
        description: 'Only when the first message lists what THE OFFICE IS ALSO WAITING ON and this email makes one of them more urgent: chase it sooner. Otherwise leave out.',
        items: {
          type: 'object',
          properties: {
            follow_up_id: { type: 'string' },
            when: { type: 'string', description: '"now", a number of working days ("1"), or a Perth date "2026-11-02".' },
            reason: { type: 'string', description: 'Why, in a sentence the office reads on the reminder.' },
          },
          required: ['follow_up_id', 'when', 'reason'],
        },
      },
    },
    required: ['needs_action', 'title', 'summary', 'priority', 'category'],
  },
}

export const CARD_SYSTEM_PROMPT = `You prepare action cards in IRC Master, the job system of Insurance Repair Co (building insurance repairs in Perth: storm and water damage, make safes, quotes, reports, trades). An email has just arrived in the office mailbox (or a follow-up the office set is due). Read it with the job file and propose what the office should do next, for a person to confirm.

How it works:
- The conversation and the job file are below. Use the read tools to check anything else you need (other emails on the job, documents, work orders, signing, excess, orders). Don't guess facts.
- To propose a step, call the tool you would use to do it (send_email, send_work_order, send_documents, send_for_signature, lodge_order, create_order_from_email, set_job_excess_decision, organise_emails…). Nothing runs: each call is recorded as a step on the card. Propose at most ${MAX_PROPOSED_STEPS} steps, in the order they should happen, and only steps the email or the job actually calls for.
- Replies: send_email with mode "reply" and the conversation_id. Write the body as plain text in the office's voice — friendly, short, Australian English, a greeting with the person's first name. No sign-off or signature: the company signature is added. Don't promise dates, amounts or anything the job file doesn't support; if something needs the office to decide, leave a clear [placeholder] for them.
- Record-keeping is automatic, never a step: every email (in and out) and everything done on a job is already in the job's Comms feed. Don't propose job notes that record what an email says or what a step did, and don't propose filing. If the conversation isn't on a job and you're sure which job it's about, give its job_number in finish_card and it's filed there automatically; if it isn't job related at all, set admin true. If filing is all it needs, nothing needs doing (needs_action false).
- If it's an insurer's new work order that hasn't become an order, propose create_order_from_email.
- Notifications, newsletters, receipts, spam-like mail, thank-yous and FYIs need nothing: call finish_card with needs_action false (you may propose organise_emails archive if it's clutter).
- Pick the category the office files this to-do under: invoice (a bill to pay), attend_submit (a site to attend, or a report or quote to finish and submit), or other.
- If the user starred the email themselves (said in the first message), it stays on their list whatever you decide — still say what it's about and suggest steps if any help.
- The first message may show WHAT THE OFFICE DID IN SIMILAR PAST CASES and LESSONS FROM THE OFFICE'S PAST DECISIONS. Their habits there outweigh your own defaults — who to write to and copy in, how they word things, which steps they keep, drop or add — but only where this case matches in the ways that matter. Say in reasoning when a past case shaped a step.
- If the office has told you what they want (THE OFFICE'S INSTRUCTIONS, in the first message), do that: their instructions override your own view and the past cases. Propose the steps they ask for, with the details they give, and say in reasoning how you followed them. If they ask for something no tool can do, say so in the summary.
- AN APPOINTMENT CHECK-IN comes after a job's calendar appointment (an inspection, a make safe, a site meeting) has ended. Look at what's been recorded on the job since it started: job notes, emails, the field app, reports, quotes, work orders. Then:
  - Sorted: a note says it went fine and nothing more is needed, or everything that should follow is done (e.g. the report is already sent). Call finish_card with needs_action false and say so in the summary.
  - Something outstanding: e.g. the report or make safe report is drafted but not sent (the insurer's report KPI is in the job file), or a note mentions a problem ("the tiles need replacing"). Propose the steps that move it on, and use category attend_submit for a report or quote to finish and send.
  - Nothing recorded since it started: call finish_card with needs_action true, title "What happened at <the place>?", a summary of what the appointment was, and propose add_job_note with a [placeholder] for the office to fill in (the one job note a card proposes by itself: the office writes it).
- A FOLLOW-UP is a reminder the office set for itself (instead of an email). First check whether it's still needed: look for a reply, a quote, a report or whatever was being waited on (list_job_emails, the conversation, the job file). If it's still outstanding, propose the chase — usually send_email to that person (a reply in the conversation it came from, or a new email to them on the job) written as a polite follow-up; if it has been done or answered, say so plainly in the summary (with when) and propose nothing. Either way it stays on the office's list. A phone call can't be made for them: if one is wanted, say who and the number from the job file in the summary.
- set_follow_up reminds the office later: propose it when something will need chasing if nothing arrives (e.g. a trade said "quote by Friday" — follow up the Monday after). Emails the office sends that ask someone for something get a reminder by themselves, so don't propose set_follow_up just because a step's email asks a question. Never propose set_follow_up (or a chase) for an insurer's or homeowner's decision on a quote or variation: the office follows quotes up only when they ask to.
- A WAITING-ON follow-up was set by IRC when the office emailed someone asking for something, and nothing has come back. Check the same way that it's still outstanding, then draft the chase: a short, polite reply in that conversation asking again for exactly what was asked (and by when, if someone is waiting on the office for it).
- Always end by calling finish_card.

Today is given in the first message. Times are Perth time (AWST).`

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; model_calls: number }

/** A short line for a proposed step, shown on the card */
export function describeStep(tool: McpTool, args: Record<string, unknown>): { summary: string; kind: StepKind } {
  const s = (k: string) => (typeof args[k] === 'string' ? (args[k] as string).trim() : '')
  switch (tool.name) {
    case 'send_email': {
      const mode = s('mode') || 'new'
      const what = mode === 'reply' ? 'Reply' : mode === 'reply_all' ? 'Reply all' : mode === 'forward' ? 'Forward' : 'Email'
      const to = s('to')
      return { summary: `${what}${to ? ` to ${to}` : ''}${s('subject') ? `: "${s('subject')}"` : ''}${s('send_at') ? ` (scheduled ${s('send_at')})` : ''}`, kind: 'email' }
    }
    case 'file_conversation':
      return { summary: s('job_number') ? `File on ${s('job_number')}` : s('filing') === 'admin' ? 'File as admin' : 'Move to To file', kind: 'filing' }
    case 'set_follow_up': {
      const when = s('when')
      const on = !when ? '' : /^\d+$/.test(when) ? ` in ${when} days` : /^\d+\s*[a-z]/i.test(when) ? ` in ${when}` : ` on ${when}`
      const note = s('note')
      return { summary: `Remind me${on}${s('who') ? ` to follow up with ${s('who')}` : ''}: ${note.length > 80 ? `${note.slice(0, 80)}…` : note}`, kind: 'change' }
    }
    case 'organise_emails':
      return { summary: `${s('action').replace('_', ' ') || 'Organise'} the conversation`.replace(/^./, c => c.toUpperCase()), kind: 'filing' }
    default: {
      const detail = ['job_number', 'work_order_id', 'order_id', 'decision', 'note'].map(s).filter(Boolean)[0]
      return { summary: `${tool.title}${detail ? ` — ${detail.length > 80 ? `${detail.slice(0, 80)}…` : detail}` : ''}`, kind: 'change' }
    }
  }
}

const today = () => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date())

type Outcome = Partial<Pick<ActionCard, 'title' | 'description' | 'reasoning' | 'steps' | 'status' | 'priority' | 'job_id' | 'outcome' | 'error_log' | 'category' | 'ai_steps' | 'situation'>>

/**
 * Makes one card (already claimed: status generating). Returns what was
 * written. Never throws — a failure is kept on the card.
 */
export async function generateCard(
  card: ActionCard,
  opts: {
    client?: Pick<Anthropic, 'beta'>
    db?: SupabaseClient
    tools?: McpTool[]
    /** What the office asked for, having seen the card's earlier suggestion ("Tell the AI what to change") */
    feedback?: string
    /** With feedback: change only this step; the card's other steps, title and summary stay as they are */
    step?: string
  } = {},
): Promise<Outcome> {
  const db = opts.db ?? mailDb()
  const save = async (o: Outcome) => {
    await db.from('action_queue').update({ ...o, updated_at: new Date().toISOString() }).eq('id', card.id)
    return o
  }
  // One step being changed: the card goes back on the list as it was if the AI can't
  const target = opts.feedback?.trim() && opts.step ? card.steps.find(s => s.id === opts.step) : undefined
  const keepCard = async (reason: string): Promise<Outcome> => ({ ...(await save({ status: 'pending' })), error_log: reason })
  try {
    const tools = cardTools(opts.tools ?? MCP_TOOLS, card.source, !!opts.feedback?.trim())
    const ctx: McpContext = { supabase: db as unknown as SupabaseClient<Database>, tenantId: card.tenant_id, userId: await cardActor(db, card.tenant_id), via: 'chat' }
    const about = card.source === 'followup'
      ? await followUpContext(card, db, ctx)
      : card.source === 'appointment'
      ? await appointmentContext(card, db, ctx)
      : await emailContext(card, db, ctx, !!card.starred_by || !!opts.feedback?.trim())
    if (!('intro' in about)) return target ? keepCard(about.outcome ?? about.error_log ?? 'The email can\'t be read') : save(about)

    const client = opts.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const toolDefs: Anthropic.Beta.BetaTool[] = [
      ...tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema })),
      FINISH,
    ]
    const learning = await cardLearning(db, card.tenant_id, about.situation, card.id)
    const feedback = opts.feedback?.trim()
    const earlier = card.steps.length ? card.steps.map((s, i) => `${i + 1}. ${s.summary}`).join('\n') : '(no steps)'
    const instructions = target
      ? `\n\nTHE OFFICE'S INSTRUCTIONS FOR ONE STEP\nThe card "${card.title}" has these steps:\n${earlier}\n…and they want only step ${card.steps.indexOf(target) + 1} ("${target.summary}") changed:\n"${feedback}"\nPropose just what replaces that step — usually one step, none if they want it dropped. The other steps stay as they are: don't propose them again. Then call finish_card (the card keeps its title and summary).`
      : feedback
      ? `\n\nTHE OFFICE'S INSTRUCTIONS\nThey looked at the earlier suggestion — "${card.title}":\n${earlier}\n…and asked for this instead:\n"${feedback}"`
      : ''
    const messages: Anthropic.Beta.BetaMessageParam[] = [{
      role: 'user',
      content: `Today: ${today()}.\n\n${about.intro}${learning ? `\n\n${learning}` : ''}${instructions}`,
    }]

    const steps: CardStep[] = []
    const usage: Usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, model_calls: 0 }
    let finish: Record<string, unknown> | null = null
    let lastText = ''

    for (let step = 1; step <= MAX_STEPS && !finish; step++) {
      const response = await trackAi({ feature: 'action-cards', provider: 'anthropic', model: CARD_MODEL, tenantId: card.tenant_id, jobId: card.job_id }, () => client.beta.messages.create({
        model: CARD_MODEL,
        max_tokens: 8000,
        system: CARD_SYSTEM_PROMPT,
        tools: toolDefs,
        tool_choice: { type: 'auto' },
        output_config: { effort: 'medium' },
        cache_control: { type: 'ephemeral' },
        messages,
      } as Anthropic.Beta.MessageCreateParamsNonStreaming))
      usage.model_calls++
      usage.input_tokens += response.usage.input_tokens
      usage.output_tokens += response.usage.output_tokens
      usage.cache_read_input_tokens += response.usage.cache_read_input_tokens ?? 0
      messages.push({ role: 'assistant', content: response.content as Anthropic.Beta.BetaContentBlockParam[] })
      lastText = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('\n').trim() || lastText

      if (response.stop_reason === 'pause_turn') continue
      if (response.stop_reason !== 'tool_use') break

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        const args = block.input && typeof block.input === 'object' ? block.input as Record<string, unknown> : {}
        let text: string
        let isError = false
        if (block.name === FINISH.name) {
          finish = args
          text = 'Card finished.'
        } else {
          const tool = tools.find(t => t.name === block.name)
          if (!tool) {
            text = `There is no tool called ${block.name}.`
            isError = true
          } else if (tool.annotations.readOnlyHint) {
            try {
              const out = await tool.run(args, ctx)
              text = out.data ? `${out.text}\n${JSON.stringify(out.data)}` : out.text
              isError = !!out.isError
            } catch (err) {
              console.error(`[action-cards] ${tool.name} failed:`, err)
              text = `${tool.title} hit an error.`
              isError = true
            }
          } else if (steps.length >= MAX_PROPOSED_STEPS) {
            text = `Not recorded: a card has at most ${MAX_PROPOSED_STEPS} steps. Call finish_card.`
            isError = true
          } else {
            const { summary, kind } = describeStep(tool, args)
            steps.push({ id: randomUUID(), tool: tool.name, args, summary, kind })
            text = `Recorded as step ${steps.length} ("${summary}") for the user to confirm. It has NOT been done.`
          }
        }
        results.push({ type: 'tool_result', tool_use_id: block.id, content: text, is_error: isError })
      }
      messages.push({ role: 'user', content: results })
      if (step === MAX_STEPS - 1 && !finish) {
        messages.push({ role: 'user', content: 'That\'s enough looking up — call finish_card now.' })
      }
    }

    if (target) {
      return save({ status: 'pending', steps: replaceStep(card.steps, target.id, steps), ai_steps: replaceAiStep(card.ai_steps, target.id, steps), situation: about.situation, error_log: null })
    }

    const f = finish ?? {}
    const str = (k: string) => (typeof f[k] === 'string' ? (f[k] as string).trim() : '')
    let jobId = about.jobId
    if (!jobId && str('job_number')) {
      const { data: job } = await db.from('jobs').select('id').eq('tenant_id', card.tenant_id).ilike('job_number', str('job_number')).maybeSingle()
      jobId = (job as { id: string } | null)?.id ?? null
    }
    // Filed by itself: the email goes into the job's Comms feed (or Admin) without a step
    const filed = card.source === 'email' && card.source_ref && !about.jobId
      ? await autoFile(db, card.tenant_id, card.source_ref, jobId ? { jobId } : f.admin === true ? { filing: 'admin' } : null)
      : null
    const priority = PRIORITY[(str('priority') || 'normal') as keyof typeof PRIORITY] ?? PRIORITY.normal

    // Starred (or re-starred) by the user while it was being read? Then it
    // stays, with their symbol
    const { data: latestRow } = await db.from('action_queue').select('starred_by').eq('id', card.id).maybeSingle()
    const starred = !!(latestRow as { starred_by: string | null } | null)?.starred_by
    // A follow-up stays on the list: the office asked to be reminded
    // A follow-up the office set stays on the list; a check IRC planned itself can find nothing's needed
    const needsAction = starred || (card.source === 'followup' && card.follow_up?.kind !== 'watch') || f.needs_action !== false || steps.length > 0
    const category = isCategory(f.category) ? f.category : 'other'

    await db.from('action_queue').update({ model: CARD_MODEL, usage }).eq('id', card.id)
    // This email makes a wait on the job more urgent: its chase comes sooner
    for (const c of Array.isArray(f.chase_sooner) ? f.chase_sooner.slice(0, 5) : []) {
      const x = c && typeof c === 'object' ? c as Record<string, unknown> : {}
      if (typeof x.follow_up_id !== 'string' || typeof x.when !== 'string') continue
      await bringForward(db, card.tenant_id, x.follow_up_id, x.when, typeof x.reason === 'string' ? x.reason : '').catch(err => console.error('[action-cards] chase sooner failed:', err))
    }
    return save({
      ...(starred ? {} : { category }),
      status: needsAction ? 'pending' : 'no_action',
      title: str('title') || about.title,
      description: [str('summary') || lastText, filed].filter(Boolean).join('\n\n') || null,
      reasoning: str('reasoning') || null,
      steps,
      // The AI's own proposal, kept as it was: what the office changes is learned from
      ai_steps: steps,
      situation: about.situation,
      priority,
      job_id: jobId,
      error_log: finish ? null : 'The AI didn\'t finish the card — check the steps',
    })
  } catch (err) {
    console.error(`[action-cards] card ${card.id} failed:`, err)
    if (target) return keepCard(err instanceof Error ? err.message : String(err))
    return save({ status: 'failed', error_log: err instanceof Error ? err.message : String(err) })
  }
}

/** Files a conversation the card AI placed, as a person filing it would. A line for the card, or null */
async function autoFile(db: SupabaseClient, tenantId: string, threadId: string, target: { jobId: string } | { filing: 'admin' } | null): Promise<string | null> {
  if (!target) return null
  try {
    const { fileThread } = await import('@/lib/mail/file-thread')
    await fileThread(await getMailbox(tenantId, db), threadId, target, db)
    if ('filing' in target) return 'Filed as admin.'
    const { data } = await db.from('jobs').select('job_number').eq('id', target.jobId).maybeSingle()
    return `Filed on ${(data as { job_number: string } | null)?.job_number ?? 'the job'}.`
  } catch (err) {
    const { logError } = await import('@/lib/health/errors')
    await logError('action-cards.auto-file', err, { tenantId, detail: { threadId } })
    return null
  }
}

/**
 * The AI's proposal after it changed one step: the old one replaced in
 * place — or, for a step the office added themselves, the new ones added.
 * Null (a card from before the learning module) stays null.
 */
export function replaceAiStep(aiSteps: CardStep[] | null, stepId: string, replacement: CardStep[]): CardStep[] | null {
  if (!aiSteps) return null
  return aiSteps.some(s => s.id === stepId) ? replaceStep(aiSteps, stepId, replacement) : [...aiSteps, ...replacement]
}

/** The card's steps with one replaced by what the AI proposed instead (nothing: it comes off) */
export function replaceStep(steps: CardStep[], stepId: string, replacement: CardStep[]): CardStep[] {
  const i = steps.findIndex(s => s.id === stepId)
  return i < 0 ? steps : [...steps.slice(0, i), ...replacement, ...steps.slice(i + 1)]
}

type Context = { intro: string; jobId: string | null; title: string; situation: Situation }

/** An email card: the conversation and the job file, up front — or no need for the model at all */
async function emailContext(card: ActionCard, db: SupabaseClient, ctx: McpContext, keep: boolean): Promise<Context | Outcome> {
  if (!card.source_ref) return { status: 'failed', error_log: 'No conversation on this card' }
  const mailbox = await getMailbox(card.tenant_id, db)
  const detail = await getThreadDetail(mailbox, card.source_ref, db)
  if (!detail) return { status: 'no_action', title: 'Conversation deleted', outcome: 'The conversation no longer exists' }
  if (detail.label_ids.some(l => l === 'SPAM' || l === 'TRASH')) {
    return { status: 'no_action', title: detail.subject || '(no subject)', outcome: 'In Spam or the Bin', job_id: detail.job?.id ?? null }
  }
  const sent = detail.messages.filter(m => !m.labelIds.includes('DRAFT'))
  const latest = sent.at(-1)
  // A star the user set stays on their list even when we've answered, as
  // does a card they've asked for changes to
  if (!keep && latest && (latest.labelIds.includes('SENT') || latest.from?.email.toLowerCase().endsWith(`@${OWN_DOMAIN}`))) {
    return { status: 'done', title: detail.subject || '(no subject)', outcome: 'Already replied', job_id: detail.job?.id ?? null }
  }
  // Who wrote: the latest email from outside the office
  const sender = [...sent].reverse().find(m => !m.labelIds.includes('SENT') && !m.from?.email.toLowerCase().endsWith(`@${OWN_DOMAIN}`))?.from ?? null
  const conversation = (await readConversation.run({ conversation_id: card.source_ref }, ctx)).text
  const jobFile = detail.job
    ? (await getJobSummary.run({ job_number: detail.job.job_number }, ctx)).text
    : `This conversation is not on a job yet.${detail.candidates.length ? ` The matcher suggests: ${detail.candidates.map(c => `${c.job_number} (${c.insured_name ?? c.property_address ?? ''}, matched on ${c.matched_on.join(', ')}, ${c.confidence})`).join('; ')}.` : ''}${detail.orderId ? ' It has already become an insurer order.' : ''}`
  // An order email on a claim that already has one: what's new compared with the original order
  const orderUpdate = await orderUpdateBrief(db, card.tenant_id, card.source_ref)
  // What the office is waiting on: the wait this answered, and others on the job it may make urgent
  const waits = await waitBrief(db, card.tenant_id, card.source_ref, detail.job?.id ?? null)
  return {
    intro: `conversation_id: ${card.source_ref}${card.starred_by ? '\n\nThe user starred this email themselves, as a to-do.' : ''}\n\nTHE CONVERSATION\n${conversation}\n\nTHE JOB FILE\n${jobFile}${orderUpdate ? `\n\n${orderUpdate}` : ''}${waits ? `\n\n${waits}` : ''}`,
    jobId: detail.job?.id ?? null,
    title: detail.subject || 'New email',
    situation: await cardSituation(db, card.tenant_id, { kind: 'email', sender, subject: detail.subject, jobId: detail.job?.id ?? null }),
  }
}

/** A follow-up now due: what the office asked to be reminded of, the job file as it is now, and the conversation it came from */
async function followUpContext(card: ActionCard, db: SupabaseClient, ctx: McpContext): Promise<Context | Outcome> {
  const f = card.follow_up
  if (!f) return { status: 'failed', error_log: 'This follow-up has nothing to say' }
  const { data: job } = card.job_id
    ? await db.from('jobs').select('job_number').eq('tenant_id', card.tenant_id).eq('id', card.job_id).maybeSingle()
    : { data: null }
  const jobNumber = (job as { job_number: string } | null)?.job_number
  const jobFile = jobNumber ? (await getJobSummary.run({ job_number: jobNumber }, ctx)).text : 'This follow-up isn\'t on a job.'
  let conversation = ''
  if (f.thread_id) {
    try {
      conversation = `\n\nTHE CONVERSATION IT WAS SET FROM (conversation_id: ${f.thread_id})\n${(await readConversation.run({ conversation_id: f.thread_id }, ctx)).text}`
    } catch {
      conversation = '\n\nThe conversation it was set from can\'t be read any more.'
    }
  }
  const set = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(card.created_at))
  const w = f.waiting
  const head = f.kind === 'watch'
    ? `A CHECK IRC PLANNED (reviewing the job on ${set}, for today): "${f.note}"${f.watch?.why ? `\nWhy: ${f.watch.why}` : ''}\nFirst see whether it's still needed: it may already have happened or been answered (a note, an email, a document, an invoice). If so, or it no longer matters, call finish_card with needs_action false and say so. Otherwise propose the step that moves the job on — usually a short email to the person involved.`
    : w
    ? `A WAITING-ON FOLLOW-UP (set on ${set}, for today): the office emailed ${w.name}${w.email ? ` <${w.email}>` : ''} asking for ${w.asked}, and nothing has come back in that conversation.${w.on_behalf_of ? `\n${w.on_behalf_of}.` : ''}${f.note.startsWith(`Chase ${w.name} for`) ? `\nWhy today: ${w.reason}` : `\nThe office's own note: "${f.note}"`}${(w.brought_forward ?? []).map(b => `\nBrought forward: ${b.reason}`).join('')}`
    : `A FOLLOW-UP THE OFFICE SET (on ${set}, for today)${f.who ? `\nWho: ${f.who}` : ''}\n"${f.note}"`
  return {
    intro: `${head}${jobNumber ? `\nJob: ${jobNumber}` : ''}${conversation}\n\nTHE JOB FILE (as it is now)\n${jobFile}`,
    jobId: card.job_id,
    title: card.title,
    situation: await cardSituation(db, card.tenant_id, { kind: 'followup', who: f.who, subject: f.note, jobId: card.job_id }),
  }
}

/** An appointment check-in: what the appointment was, and the job file as it stands now (what's been recorded since) */
async function appointmentContext(card: ActionCard, db: SupabaseClient, ctx: McpContext): Promise<Context | Outcome> {
  const { data: event } = card.source_ref
    ? await db.from('calendar_events').select('summary, description, location, start_at, end_at, status').eq('tenant_id', card.tenant_id).eq('id', card.source_ref).maybeSingle()
    : { data: null }
  const e = event as { summary: string | null; description: string | null; location: string | null; start_at: string | null; end_at: string | null; status: string } | null
  if (!e) return { status: 'no_action', outcome: 'The appointment is no longer in the calendar' }
  if (e.status === 'cancelled') return { status: 'no_action', outcome: 'The appointment was cancelled' }
  const { data: job } = card.job_id
    ? await db.from('jobs').select('job_number').eq('tenant_id', card.tenant_id).eq('id', card.job_id).maybeSingle()
    : { data: null }
  const jobNumber = (job as { job_number: string } | null)?.job_number
  if (!jobNumber) return { status: 'no_action', outcome: 'The appointment isn\'t on a job any more' }
  const jobFile = (await getJobSummary.run({ job_number: jobNumber }, ctx)).text
  const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : 'unknown')
  return {
    intro: `AN APPOINTMENT CHECK-IN: this appointment on ${jobNumber} has ended.\n"${e.summary ?? '(no title)'}", ${when(e.start_at)} to ${when(e.end_at)}${e.location ? `, at ${e.location}` : ''}${e.description ? `\nIts notes: ${e.description.slice(0, 1000)}` : ''}\nCheck what's been recorded on the job since ${when(e.start_at)} (list_job_emails and the job file's notes, documents and work orders).\n\nTHE JOB FILE (as it is now)\n${jobFile}`,
    jobId: card.job_id,
    title: card.title,
    situation: await cardSituation(db, card.tenant_id, { kind: 'appointment', subject: e.summary ?? '', jobId: card.job_id }),
  }
}

/** Makes queued cards until the time budget runs out (webhook and the minute cron) */
export async function drainCardQueue({ budgetMs = 60_000, db = mailDb() }: { budgetMs?: number; db?: SupabaseClient } = {}): Promise<{ made: number }> {
  if (!process.env.ANTHROPIC_API_KEY) return { made: 0 }
  const started = Date.now()
  let made = 0
  while (Date.now() - started < budgetMs) {
    const [card] = await claimQueued(db, 1)
    if (!card) break
    const out = await generateCard(card, { db })
    // A kind of card the office has set to auto-confirm runs now
    if (out.status === 'pending') {
      const { autoConfirmCard } = await import('./auto-confirm')
      await autoConfirmCard(db, card.tenant_id, card.id)
    }
    made++
  }
  return { made }
}

/**
 * Makes (or remakes) a card now — "Suggest next steps", "Try again" and
 * "Re-suggest" ("Tell the AI what to change": feedback, followed over the
 * AI's own view). By card (any card, remade where it is) or by conversation
 * (a fresh read even if it was made for this email before). Emails edited in
 * the composer are replaced by the new suggestion. Returns the card as it is
 * afterwards, or null if it couldn't be queued.
 */
export async function resuggestCard(
  db: SupabaseClient,
  tenantId: string,
  target: { cardId: string } | { threadId: string },
  feedback = '',
  /** Who asked — their instructions are learned from */
  userId: string | null = null,
): Promise<ActionCard | null> {
  let id: string | null
  if ('cardId' in target) {
    const card = await getCard(db, tenantId, target.cardId)
    if (!card) throw new CardError('Card not found', 404)
    if (card.status === 'scheduled' || card.status === 'running') throw new CardError('That card can\'t be re-suggested now', 409)
    id = card.id
  } else {
    id = await queueEmailCard(db, tenantId, target.threadId, null)
  }
  if (!id) return null
  const before = await getCard(db, tenantId, id)
  if (before && feedback.trim()) await recordCardInstruction(db, before, userId, feedback)
  if (before) {
    const { discardStepDrafts } = await import('./steps')
    await discardStepDrafts(before, db)
  }
  await db.from('action_queue').update({ status: 'queued', attempts: 0 }).eq('id', id).in('status', ['pending', 'failed', 'queued'])

  // Take this one if it's still queued; otherwise another run is making it
  const queued = await getCard(db, tenantId, id)
  if (queued?.status === 'queued') {
    const { data: won } = await db.from('action_queue').update({ status: 'generating', attempts: 1, updated_at: new Date().toISOString() })
      .eq('id', id).eq('status', 'queued').select('*').maybeSingle()
    if (won) await generateCard(won as ActionCard, { db, feedback })
  }
  return getCard(db, tenantId, id)
}

/**
 * "Tell the AI what to change" for one step: the AI replaces just that step
 * (or takes it off) following the office's instructions; the other steps —
 * emails edited in the composer included — the title and the summary stay.
 * The card is held (generating) meanwhile so its steps can't be done. Throws
 * if the AI couldn't, leaving the card as it was.
 */
export async function resuggestStep(
  db: SupabaseClient,
  tenantId: string,
  cardId: string,
  stepId: string,
  feedback: string,
  /** Who asked — their instructions are learned from */
  userId: string | null = null,
): Promise<ActionCard> {
  const card = await getCard(db, tenantId, cardId)
  if (!card) throw new CardError('Card not found', 404)
  const step = card.steps.find(s => s.id === stepId)
  if (!step) throw new CardError('That step isn\'t on the card any more', 404)
  if (step.status === 'done' || step.status === 'waiting') throw new CardError('That step has already been done', 409)
  if (!feedback.trim()) throw new CardError('Say what this step should do instead')

  const { data: won } = await db.from('action_queue').update({ status: 'generating', updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', card.id).in('status', ['pending', 'failed']).select('*').maybeSingle()
  if (!won) throw new CardError('That card can\'t be changed now', 409)
  await recordCardInstruction(db, card, userId, feedback, stepId)
  const out = await generateCard(won as ActionCard, { db, feedback, step: stepId })
  if (out.error_log) throw new CardError(`The AI couldn't change that step: ${out.error_log}`)
  // The email it replaced was edited in the composer: that draft goes
  if (step.draft) {
    const { discardStepDrafts } = await import('./steps')
    await discardStepDrafts({ ...card, steps: [step] }, db)
  }
  return (await getCard(db, tenantId, card.id))!
}
