import type { SupabaseClient } from '@supabase/supabase-js'
import { debrief, type DebriefPoint } from '@/lib/learning/debrief'
import { getCard } from './cards'
import { compareCard, FEATURE, situationText } from './learning'

// Teaching from an action card (tech spec §24.8): what the office says about a
// card — confirming it, editing it, skipping it or sending it back — is
// debriefed into takeaways that work from the next card on. Said nothing:
// nothing to do (a plain confirm or skip is still recorded as it was).

const STATUS_WORDS: Record<string, string> = { done: 'The office confirmed it', skipped: 'The office cleared it (took it off the list without doing it)', pending: 'It\'s still on the list', failed: 'A step failed' }

/** What the AI proposed on the card and what the office did with it, in plain lines */
export function cardHappened(card: { status: string; ai_steps: { id: string; summary: string }[] | null; steps: { id: string; summary: string; status?: string | null }[]; title: string }): string {
  const proposed = (card.ai_steps ?? card.steps).map(s => `- ${s.summary}`).join('\n') || '- (no steps: nothing needed doing)'
  const lines = [`The card: "${card.title}"`, `The AI proposed:\n${proposed}`, STATUS_WORDS[card.status] ?? `Status: ${card.status}`]
  if ((card.status === 'done' || card.status === 'skipped') && card.ai_steps) {
    const { changes, outcome } = compareCard(card.ai_steps as never, card.steps as never, card.status === 'done' ? 'confirmed' : 'skipped')
    lines.push(changes.length ? `What the office changed:\n${changes.map(c => `- ${c}`).join('\n')}` : outcome === 'accepted' ? 'Confirmed exactly as proposed.' : '')
  }
  return lines.filter(Boolean).join('\n')
}

/**
 * Debriefs what the office said about a card. recordEvent false when the
 * words are already recorded (a card sent back with instructions).
 */
export async function teachFromCard(db: SupabaseClient, tenantId: string, userId: string | null, cardId: string, said: string, opts: { recordEvent?: boolean } = {}): Promise<DebriefPoint[]> {
  if (!said.trim()) return []
  const card = await getCard(db, tenantId, cardId)
  if (!card) return []
  const situation = card.situation ?? {}
  return debrief(db, {
    tenantId, userId, feature: FEATURE, said, situation,
    situationText: situationText(situation),
    happened: cardHappened(card as never),
    recordEvent: opts.recordEvent === false ? false : { sourceTable: 'action_queue', sourceId: card.id, kind: card.category },
  })
}
