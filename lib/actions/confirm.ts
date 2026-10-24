import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { callTool, type McpContext, type McpTool } from '@/lib/mcp/server'
import { MCP_TOOLS } from '@/lib/mcp/tools'
import { mailDb } from '@/lib/mail/sync'
import { getCard, type ActionCard, type CardStep } from './cards'

// Confirming an action card: the chosen steps run in order, each through
// callTool as the signed-in user — their permissions apply ("needs approval"
// turns a step into an approval request), and each one is in the
// who-did-what log. Steps already done are never run twice; the first
// failure stops the rest, which stay on the card to retry.

export class CardError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 = 400) {
    super(message)
    this.name = 'CardError'
  }
}

/** What the user may change on a step before it runs */
const EDITABLE: Record<string, string[]> = {
  send_email: ['to', 'cc', 'bcc', 'subject', 'body', 'send_at'],
  add_job_note: ['note'],
  file_conversation: ['job_number', 'filing'],
}

export type StepChoice = { id: string; args?: Record<string, unknown> }

export async function confirmCard(
  tenantId: string,
  userId: string,
  cardId: string,
  choices: StepChoice[],
  { db = mailDb(), tools = MCP_TOOLS, via = 'chat', voiceKeyId }: {
    db?: SupabaseClient
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
      if (!step.status || step.status === 'failed') step.status = 'skipped'
      continue
    }
    if (stopped) continue
    // Only the fields a person would edit; everything else is as proposed
    const edits = Object.fromEntries(Object.entries(choice.args ?? {}).filter(([k]) => (EDITABLE[step.tool] ?? []).includes(k)))
    const args = { ...step.args, ...edits }
    const tool = tools.find(t => t.name === step.tool)
    if (!tool) {
      Object.assign(step, { status: 'failed', result: `The action "${step.tool}" isn't available any more` })
      stopped = true
      continue
    }
    const out = await callTool(tool, args, ctx)
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
  const update = failed
    ? { status: 'failed', error_log: `${failed.summary}: ${failed.result ?? 'failed'}` }
    : {
        status: 'done',
        error_log: null,
        outcome: [doneCount ? `${doneCount} step${doneCount === 1 ? '' : 's'} done` : null, waiting ? `${waiting} waiting for approval` : null].filter(Boolean).join(', ') || 'Nothing done',
        confirmed_by: userId,
        confirmed_at: new Date().toISOString(),
      }
  const { data, error } = await db.from('action_queue')
    .update({ ...update, steps, updated_at: new Date().toISOString() })
    .eq('id', card.id).select('*').single()
  if (error) throw new Error(error.message)
  return data as ActionCard
}
