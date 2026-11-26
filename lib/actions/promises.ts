import type { SupabaseClient } from '@supabase/supabase-js'
import { recordLearning, type Situation } from '@/lib/learning/events'
import { activeLessons, formatLessons } from '@/lib/learning/lessons'
import { createFollowUp } from './followups'
import type { ActionCard } from './cards'

// The office's own promises (tech spec §23.12): when an email the office sends
// says the office will do something — "I'll chase the painter for a booking
// date", "I'll send the report through on Friday" — the sent-email read
// (waiting-on.ts) finds it and IRC puts a to-do on the sender's list, due now
// or on the day promised, for the card AI to draft what keeps the promise
// (the chase email to the painter). What the office asks of others is the
// wait, not a promise. Skipping one teaches the read (feature 'promise').

export const FEATURE = 'promise'
const DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX = 3

/** A promise the AI found in a sent email */
export type FoundPromise = { what: string; who?: string | null; due_date?: string | null; evidence?: string | null }

/** What the read is shown about past promises: the lessons, the office memory with them */
export async function promiseLearning(db: SupabaseClient, tenantId: string): Promise<string> {
  const text = formatLessons(await activeLessons(db, tenantId, FEATURE))
  return text ? `PROMISES — ${text}` : ''
}

const LIVE = ['pending', 'queued', 'scheduled', 'generating']

/**
 * Puts each promise on the sender's list as a to-do (the AI drafts its steps
 * when it's due). Returns a line for each, for the read's outcome. Never throws.
 */
export async function addPromiseTodos(db: SupabaseClient, params: {
  tenantId: string; userId: string | null; jobId: string | null; threadId: string; messageId: string; to: string | null; promises: FoundPromise[]
}): Promise<string[]> {
  const out: string[] = []
  for (const p of params.promises.slice(0, MAX)) {
    const what = (p.what ?? '').trim().replace(/\s+/g, ' ').slice(0, 200)
    if (!what) continue
    try {
      const note = `You said you'd ${what.replace(/^(you('ll| will)|i('ll| will)|we('ll| will))\s+/i, '')}`
      // Not twice: the same promise already on the list for this conversation
      const { data: same } = await db.from('action_queue').select('id').eq('tenant_id', params.tenantId).eq('source', 'followup')
        .eq('title', note.slice(0, 120)).in('status', LIVE).limit(1)
      if ((same as unknown[] | null)?.length) continue
      const due = p.due_date && DATE.test(p.due_date) ? `${p.due_date}T00:00:00.000Z` : '' // 8am Perth on the day, else now
      const evidence = p.evidence?.trim().slice(0, 300) || null
      const card = await createFollowUp(db, params.tenantId, params.userId, {
        jobId: params.jobId, note: evidence ? `${note}\nYou wrote: "${evidence}"` : note, who: p.who?.trim() || null,
        dueAt: due && new Date(due).getTime() > Date.now() ? due : '', threadId: params.threadId,
        todo: { mode: 'do' }, promise: { evidence, message_id: params.messageId },
      })
      const situation: Situation = { kind: 'sent_email', recipient_email: params.to?.toLowerCase() ?? null, who: p.who?.trim().toLowerCase() || null }
      await recordLearning(db, {
        tenantId: params.tenantId, feature: FEATURE, sourceTable: 'action_queue', sourceId: card.id, situation,
        situationText: `A promise in an email the office sent${params.to ? ` to ${params.to}` : ''}: "${evidence ?? what}"`,
        proposed: { what, who: p.who ?? null, due_date: p.due_date ?? null }, outcome: 'accepted', kind: 'todo', userId: null,
      })
      out.push(`${note}${due ? ` (due ${p.due_date})` : ''}`)
    } catch (err) {
      console.error('[promises] to-do not added:', err)
    }
  }
  return out
}

/** A promise to-do skipped: the read shouldn't have made it — recorded for the learning module */
export async function recordPromiseSkipped(db: SupabaseClient, card: ActionCard, userId: string | null): Promise<void> {
  const promise = card.follow_up?.promise
  if (!promise) return
  const { data: made } = await db.from('learning_events').select('situation').eq('tenant_id', card.tenant_id).eq('feature', FEATURE).eq('source_id', card.id).limit(1)
  const situation = ((made as { situation: Situation }[] | null) ?? [])[0]?.situation ?? { kind: 'sent_email' }
  await recordLearning(db, {
    tenantId: card.tenant_id, feature: FEATURE, sourceTable: 'action_queue', sourceId: card.id, situation,
    situationText: `A promise IRC took from a sent email, skipped: "${promise.evidence ?? card.title}"`,
    changes: [`Skipped: ${card.title}`], outcome: 'skipped', kind: 'todo', userId,
  })
}
