import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { callTool, type McpContext, type McpTool } from '@/lib/mcp/server'
import { MCP_TOOLS } from '@/lib/mcp/tools'
import { fitJobAttachments, hasAttachArgs, loadJobAttachments, storeJobAttachments } from '@/lib/mcp/tools/job-attachments'
import { plainTextToRichHtml } from '@/lib/email/rich-text'
import { ComposeError, discardDraft, openDraft, startCompose } from '@/lib/mail/compose'
import { isComposeMode, type ComposeStart } from '@/lib/mail/compose-rules'
import { getThreadDetail } from '@/lib/mail/list'
import { getMailbox, mailDb } from '@/lib/mail/sync'
import { CardError, cardThreadId, getCard, type ActionCard, type CardStep, type StepDraft } from './cards'
import { describeStep } from './propose'
import { applyEdits, cleanEdits, stepFields, type StepField } from './step-fields'

// One action card step, opened on the card: its details as a form, a preview
// of what it acts on (the order to lodge, the standard email a work order or
// document goes with, the job's signing or excess), and changes to it saved
// on the card before it runs. An email step opens in the Mail page's
// composer instead: a Gmail draft, which the step then sends as it is.

/** Read tools that show what a step acts on, from the step's own arguments */
const PREVIEWS: Record<string, { tool: string; title: string; args(a: Record<string, unknown>): Record<string, unknown> }> = {
  send_work_order: { tool: 'get_work_order_email', title: 'The work order and its email', args: a => ({ work_order_id: a.work_order_id }) },
  send_documents: { tool: 'get_document_email', title: 'The documents and their email', args: a => ({ documents: a.documents }) },
  send_for_signature: { tool: 'get_signing', title: 'Signing on this job', args: a => ({ job_number: a.job_number }) },
  set_job_excess_decision: { tool: 'get_job_excess', title: 'The job\'s excess now', args: a => ({ job_number: a.job_number }) },
}

/** Fields the preview fills in when the step leaves them to the standard email */
const PREFILL = ['to', 'cc', 'subject', 'body']

/** Records a step acts on that can be corrected first, with the tool that corrects them */
const RECORDS: Record<string, { title: string; read: string; update: string; idKey: string; pick(data: Record<string, unknown>, id: string): Record<string, unknown> | null }> = {
  lodge_order: {
    title: 'The order to lodge',
    read: 'list_insurer_orders',
    update: 'update_insurer_order',
    idKey: 'order_id',
    pick: (data, id) => ((data.orders as Record<string, unknown>[] | undefined) ?? []).find(o => o.order_id === id) ?? null,
  },
}

const NOTES: Record<string, string> = {
  create_order_from_email: 'The order\'s details are read from the email when this step runs. You can check and correct them before it\'s lodged.',
  file_conversation: 'Files this conversation (and its attachments) on the job.',
}

export type StepRecord = { title: string; id: string; fields: StepField[]; warnings: string[] }

export type StepDetail = {
  fields: StepField[]
  preview: { title: string; text: string } | null
  record: StepRecord | null
  note: string | null
}

function findStep(card: ActionCard | null, stepId: string): CardStep {
  if (!card) throw new CardError('Card not found', 404)
  const step = card.steps.find(s => s.id === stepId)
  if (!step) throw new CardError('That step isn\'t on this card', 404)
  return step
}

function toolFor(step: CardStep, tools: McpTool[]): McpTool {
  const tool = tools.find(t => t.name === step.tool)
  if (!tool) throw new CardError(`The action "${step.tool}" isn't available any more`)
  return tool
}

const asCtx = (db: SupabaseClient, tenantId: string, userId: string): McpContext =>
  ({ supabase: db as unknown as SupabaseClient<Database>, tenantId, userId, via: 'chat' })

/** What the step will do, in full: its details, and what it acts on */
export async function stepDetail(
  tenantId: string, userId: string, cardId: string, stepId: string,
  { db = mailDb(), tools = MCP_TOOLS }: { db?: SupabaseClient; tools?: McpTool[] } = {},
): Promise<StepDetail> {
  const step = findStep(await getCard(db, tenantId, cardId), stepId)
  const tool = toolFor(step, tools)
  const ctx = asCtx(db, tenantId, userId)
  const fields = stepFields(tool.inputSchema, step.args)

  let preview: StepDetail['preview'] = null
  const p = PREVIEWS[step.tool]
  const reader = p && tools.find(t => t.name === p.tool)
  if (p && reader) {
    const out = await callTool(reader, p.args(step.args), ctx)
    preview = { title: p.title, text: out.text }
    // Start from the standard email, so a change is to what would be sent
    for (const f of fields) {
      const standard = out.data?.[f.key]
      if (PREFILL.includes(f.key) && f.value === null && typeof standard === 'string') f.value = standard
    }
  }

  let record: StepRecord | null = null
  const r = RECORDS[step.tool]
  const id = r && typeof step.args[r.idKey] === 'string' ? step.args[r.idKey] as string : ''
  const [read, update] = r ? [tools.find(t => t.name === r.read), tools.find(t => t.name === r.update)] : []
  if (r && id && read && update) {
    const out = await callTool(read, {}, ctx)
    const row = out.data ? r.pick(out.data, id) : null
    if (row) {
      record = {
        title: r.title,
        id,
        fields: stepFields(update.inputSchema, row),
        warnings: Array.isArray(row.warnings) ? row.warnings.map(String) : [],
      }
    } else if (!step.status) {
      preview = { title: r.title, text: 'This order isn\'t waiting to be lodged any more — it may have been lodged or deleted.' }
    }
  }

  return { fields, preview, record, note: NOTES[step.tool] ?? null }
}

/** Steps can change until they've run, on a card still to do */
function assertOpen(card: ActionCard, step: CardStep) {
  if (card.status !== 'pending' && card.status !== 'failed') throw new CardError(`This card is ${card.status} — refresh to see where it's at`, 409)
  if (step.status === 'done' || step.status === 'waiting') throw new CardError('That step has already been done', 409)
}

/**
 * Writes the card's steps back. Not its updated_at: the card is the same
 * card (and the page keeps it open while it's being edited).
 */
async function saveSteps(db: SupabaseClient, card: ActionCard, steps: CardStep[]): Promise<ActionCard> {
  const { data, error } = await db.from('action_queue').update({ steps }).eq('id', card.id).select('*').single()
  if (error) throw new Error(error.message)
  return data as ActionCard
}

/** Saves a person's changes to a step (only the fields its tool lets them change) */
export async function saveStepEdits(
  tenantId: string, cardId: string, stepId: string, edits: Record<string, unknown>,
  { db = mailDb(), tools = MCP_TOOLS }: { db?: SupabaseClient; tools?: McpTool[] } = {},
): Promise<ActionCard> {
  const card = await getCard(db, tenantId, cardId)
  const step = findStep(card, stepId)
  assertOpen(card!, step)
  const tool = toolFor(step, tools)
  const cleaned = cleanEdits(tool.inputSchema, edits)
  if (!Object.keys(cleaned).length) throw new CardError('Nothing on that step can be changed that way')
  const steps = card!.steps.map(s => {
    if (s.id !== stepId) return s
    const args = applyEdits(s.args, cleaned)
    return { ...s, args, summary: describeStep(tool, s.draft ? { ...args, to: s.draft.to, subject: s.draft.subject } : args).summary }
  })
  return saveSteps(db, card!, steps)
}

const DRAFT_ID_RE = /^[A-Za-z0-9_-]+$/

/** Keeps the composer's draft on an email step (null: back to the AI's email) */
export async function saveStepDraft(
  tenantId: string, cardId: string, stepId: string, draft: StepDraft | null,
  { db = mailDb(), tools = MCP_TOOLS }: { db?: SupabaseClient; tools?: McpTool[] } = {},
): Promise<ActionCard> {
  const card = await getCard(db, tenantId, cardId)
  const step = findStep(card, stepId)
  assertOpen(card!, step)
  if (step.tool !== 'send_email') throw new CardError('Only an email step has a draft')
  if (draft && !DRAFT_ID_RE.test(draft.id)) throw new CardError('Invalid draft')
  const tool = toolFor(step, tools)
  const steps = card!.steps.map(s => {
    if (s.id !== stepId) return s
    const next: CardStep = { ...s }
    if (draft) next.draft = draft
    else delete next.draft
    next.summary = describeStep(tool, draft ? { ...s.args, to: draft.to, subject: draft.subject } : s.args).summary
    return next
  })
  return saveSteps(db, card!, steps)
}

/**
 * An email step ready for the composer: its draft if it's been edited,
 * else the reply, forward or new email it proposes — recipients, subject and
 * quoted email as the Mail page starts them, with the AI's text and any job
 * photos or files it chose.
 */
export async function stepCompose(tenantId: string, cardId: string, stepId: string, db = mailDb()): Promise<ComposeStart> {
  const card = await getCard(db, tenantId, cardId)
  const step = findStep(card, stepId)
  if (step.tool !== 'send_email') throw new CardError('That step isn\'t an email')
  const mailbox = await getMailbox(tenantId, db)
  if (step.draft) {
    try {
      return await openDraft(mailbox, tenantId, step.draft.id, db)
    } catch (err) {
      // Sent or deleted in Gmail: start again from the AI's email
      if (!(err instanceof ComposeError)) throw err
    }
  }
  const a = step.args
  const s = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '')
  const mode = isComposeMode(a.mode) ? a.mode : 'new'
  let messageId = s('message_id') || null
  if (mode !== 'new' && !messageId) {
    const threadId = s('conversation_id') || cardThreadId(card!)
    const detail = threadId ? await getThreadDetail(mailbox, threadId, db) : null
    messageId = detail?.messages.filter(m => !m.labelIds.includes('DRAFT')).at(-1)?.id ?? null
    if (!messageId) throw new CardError('The conversation this replies to no longer exists', 404)
  }
  let jobId = card!.job_id
  if (s('job_number')) {
    const { data } = await db.from('jobs').select('id').eq('tenant_id', tenantId).ilike('job_number', s('job_number')).maybeSingle()
    jobId = (data as { id: string } | null)?.id ?? jobId
  }
  const start = await startCompose(mailbox, mode, messageId, jobId, db)
  const state: ComposeStart = {
    ...start,
    to: typeof a.to === 'string' ? a.to : start.to,
    cc: typeof a.cc === 'string' ? a.cc : start.cc,
    bcc: typeof a.bcc === 'string' ? a.bcc : start.bcc,
    subject: s('subject') || start.subject,
    body: s('body') ? plainTextToRichHtml(s('body')) : start.body,
  }
  // The job photos, files and documents the AI chose, as send_email attaches them
  if (jobId && hasAttachArgs(a)) {
    const { data: job } = await db.from('jobs').select('id, job_number').eq('tenant_id', tenantId).eq('id', jobId).maybeSingle()
    const ctx = asCtx(db, tenantId, '')
    const loaded = job ? await loadJobAttachments(a, ctx, job as { id: string; job_number: string }) : []
    if (Array.isArray(loaded)) {
      const fit = await fitJobAttachments(loaded, state.attachments.reduce((n, x) => n + (x.size || 0), 0))
      state.attachments = [...state.attachments, ...await storeJobAttachments(ctx, fit.kept)]
    }
  }
  return state
}

/** Corrects the record a step acts on (e.g. the order before it's lodged), through its tool as the user */
export async function updateStepRecord(
  tenantId: string, userId: string, cardId: string, stepId: string, values: Record<string, unknown>,
  { db = mailDb(), tools = MCP_TOOLS }: { db?: SupabaseClient; tools?: McpTool[] } = {},
): Promise<{ text: string; ok: boolean }> {
  const card = await getCard(db, tenantId, cardId)
  const step = findStep(card, stepId)
  assertOpen(card!, step)
  const r = RECORDS[step.tool]
  const update = r && tools.find(t => t.name === r.update)
  const id = r && typeof step.args[r.idKey] === 'string' ? step.args[r.idKey] as string : ''
  if (!r || !update || !id) throw new CardError('There\'s nothing to correct on that step')
  const cleaned = Object.fromEntries(Object.entries(cleanEdits(update.inputSchema, values)).map(([k, v]) => [k, v ?? '']))
  if (!Object.keys(cleaned).length) throw new CardError('Nothing to change')
  const out = await callTool(update, { ...cleaned, [r.idKey]: id }, asCtx(db, tenantId, userId))
  return { text: out.text, ok: !out.isError }
}

/** Discards the drafts of a card's unsent emails (the card was skipped or is being re-suggested) */
export async function discardStepDrafts(card: ActionCard, db = mailDb()): Promise<void> {
  const drafts = card.steps.filter(s => s.draft && s.status !== 'done' && s.status !== 'waiting').map(s => s.draft!.id)
  if (!drafts.length) return
  const mailbox = await getMailbox(card.tenant_id, db)
  for (const id of drafts) {
    try {
      await discardDraft(mailbox, id, db)
    } catch (err) {
      // Already sent or deleted in Gmail
      console.error('[actions] could not discard a step draft:', err)
    }
  }
}
