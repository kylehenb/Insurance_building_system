import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { callTool, type McpContext, type McpTool } from '@/lib/mcp/server'
import { MCP_TOOLS } from '@/lib/mcp/tools'
import { mailDb } from '@/lib/mail/sync'
import { CardError, getCard, type ActionCard, type CardStep } from './cards'
import { recordCardDecision } from './learning'
import { applyEdits, cleanEdits } from './step-fields'

// Confirming an action card: the chosen steps run in order, each through
// callTool as the signed-in user — their permissions apply ("needs approval"
// turns a step into an approval request), and each one is in the
// who-did-what log. Steps already done are never run twice; the first
// failure stops the rest, which stay on the card to retry.

export { CardError }

/** Fields an email change rewrites — the composer's draft is then left aside */
const EMAIL_TEXT = ['to', 'cc', 'bcc', 'subject', 'body']

export type StepChoice = { id: string; args?: Record<string, unknown> }

export async function confirmCard(
  tenantId: string,
  userId: string,
  cardId: string,
  choices: StepChoice[],
  { db = mailDb(), tools = MCP_TOOLS, via = 'chat', voiceKeyId, only = false, auto = false }: {
    db?: SupabaseClient
    /** Run by auto-confirm (lib/actions/auto-confirm.ts), not a person: said so on the card, and not learned from */
    auto?: boolean
    /** Run just these steps and leave the rest on the card (an email sent from its composer) */
    only?: boolean
    tools?: McpTool[]
    /** Who's confirming: the app (default) or the voice connector — the steps are logged as that */
    via?: 'chat' | 'voice'
    voiceKeyId?: string
  } = {},
): Promise<ActionCard> {
  const card = await getCard(db, tenantId, cardId)
  if (!card) throw new CardError('Card not found', 404)
  if (card.status !== 'pending' && card.status !== 'failed') throw new CardError(`This card is ${card.status} — refresh to see where it's at`, 409)
  const chosen = new Map(choices.map(c => [c.id, c]))
  if (!card.steps.some(s => chosen.has(s.id) && s.status !== 'done')) throw new CardError('Choose at least one step to do')

  // Claim it, so a second click doesn't run the steps twice
  const { data: claimed } = await db.from('action_queue').update({ status: 'running', updated_at: new Date().toISOString() })
    .eq('id', card.id).in('status', ['pending', 'failed']).select('id').maybeSingle()
  if (!claimed) throw new CardError('Someone else is confirming this card', 409)

  const ctx: McpContext = { supabase: db as unknown as SupabaseClient<Database>, tenantId, userId, via: via === 'chat' ? 'chat' : undefined, voiceKeyId }
  const steps: CardStep[] = card.steps.map(s => ({ ...s }))
  let stopped = false

  for (const step of steps) {
    if (step.status === 'done') continue
    const choice = chosen.get(step.id)
    if (!choice) {
      if (!only && (!step.status || step.status === 'failed')) step.status = 'skipped'
      continue
    }
    if (stopped) continue
    const tool = tools.find(t => t.name === step.tool)
    if (!tool) {
      Object.assign(step, { status: 'failed', result: `The action "${step.tool}" isn't available any more` })
      stopped = true
      continue
    }
    // Only the fields a person would edit; everything else is as proposed
    const edits = cleanEdits(tool.inputSchema, choice.args)
    const args = applyEdits(step.args, edits)
    // An email edited in the composer sends its draft, as it is — unless
    // this change rewrites the email itself
    let runArgs = args
    if (step.tool === 'send_email' && step.draft) {
      if (EMAIL_TEXT.some(k => k in edits)) delete step.draft
      else runArgs = { draft_id: step.draft.id, ...(args.send_at ? { send_at: args.send_at } : {}) }
    }
    const out = await callTool(tool, runArgs, ctx)
    step.args = args
    step.ran_at = new Date().toISOString()
    step.result = out.text
    if (out.data && (out.data as { pending_approval?: boolean }).pending_approval) {
      step.status = 'waiting'
    } else if (out.isError) {
      step.status = 'failed'
      stopped = true
    } else {
      step.status = 'done'
    }
  }

  const failed = steps.find(s => s.status === 'failed')
  const doneCount = steps.filter(s => s.status === 'done').length
  const waiting = steps.filter(s => s.status === 'waiting').length
  const left = only && steps.some(s => !s.status)
  const update = failed
    ? { status: 'failed', error_log: `${failed.summary}: ${failed.result ?? 'failed'}` }
    : left
    ? { status: 'pending', error_log: null }
    : {
        status: 'done',
        error_log: null,
        outcome: `${auto ? 'Auto-confirmed: ' : ''}${[doneCount ? `${doneCount} step${doneCount === 1 ? '' : 's'} done` : null, waiting ? `${waiting} waiting for approval` : null].filter(Boolean).join(', ') || 'Nothing done'}`,
        confirmed_by: userId,
        confirmed_at: new Date().toISOString(),
      }
  const { data, error } = await db.from('action_queue')
    .update({ ...update, steps, updated_at: new Date().toISOString() })
    .eq('id', card.id).select('*').single()
  if (error) throw new Error(error.message)
  // Done: what the office did with the AI's proposal is learned from (not
  // what auto-confirm did — that would only teach the AI to agree with itself)
  if (update.status === 'done' && !auto) await recordCardDecision(db, data as ActionCard, userId, 'confirmed')
  return data as ActionCard
}
