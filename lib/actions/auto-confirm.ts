import type { SupabaseClient } from '@supabase/supabase-js'
import { autoConfirmFor } from '@/lib/learning/auto-confirm'
import { permissionLevel } from '@/lib/permissions/resolve'
import { CATEGORIES, getCard, type ActionCard } from './cards'
import { confirmCard } from './confirm'
import { FEATURE } from './learning'

// Auto-confirm for action cards (tech spec §24.7): when the office has turned
// it on for a card's category, a newly made card's steps run straight away —
// as the person who turned it on, with their permissions (a step at "needs
// approval" waits for approval as usual). Off for every category until
// someone turns it on. Never: a card the user starred themselves, a
// follow-up, a card the AI didn't finish, or one with nothing to do.

/** The kinds an action card can be auto-confirmed by: its category */
export const CARD_KINDS: string[] = CATEGORIES.map(c => c.key)

/** Whether this card may run by itself, whatever the switch says */
export function mayAutoConfirm(card: ActionCard): boolean {
  return card.status === 'pending' && card.source === 'email' && !card.starred_by && !card.error_log
    && card.steps.length > 0 && card.steps.every(s => !s.status)
}

/** Runs a just-made card if its category is set to auto-confirm. Returns the card if it ran. Never throws */
export async function autoConfirmCard(db: SupabaseClient, tenantId: string, cardId: string): Promise<ActionCard | null> {
  try {
    const card = await getCard(db, tenantId, cardId)
    if (!card || !mayAutoConfirm(card)) return null
    const on = await autoConfirmFor(db, tenantId, FEATURE, card.category)
    if (!on) return null
    // The person it runs as must still be allowed to confirm cards
    if ((await permissionLevel(tenantId, on.userId, 'actions.review')) !== 'allowed') return null
    return await confirmCard(tenantId, on.userId, card.id, card.steps.map(s => ({ id: s.id })), { db, auto: true })
  } catch (err) {
    console.error(`[action-cards] auto-confirm of ${cardId} failed:`, err)
    return null
  }
}
