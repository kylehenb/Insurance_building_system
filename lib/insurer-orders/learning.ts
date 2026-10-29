import type { SupabaseClient } from '@supabase/supabase-js'
import { activeLessons, formatLessons } from '@/lib/learning/lessons'
import { formatCases, recordLearning, similarCases, type Likeness, type Situation } from '@/lib/learning/events'
import { normaliseLossType } from '@/lib/loss-types'
import { mapWorkOrderType } from './work-order-type'

// Order parsing on the learning module (tech spec §24.4): when an order is
// lodged, the AI's parse (insurer_orders.gemini_output) is compared with the
// order as the office lodged it, and the fields they corrected are recorded
// with who sent it. The parser then reads the most alike past orders — the
// same sender or insurer first — and the lessons, before it parses the next.
// (This replaced the "Save as learning example" prompt and parser_examples.)

export const FEATURE = 'order_parse'

/** The order fields the parser fills that the office checks before lodging */
export const ORDER_FIELDS = [
  'claim_number', 'insured_name', 'insured_phone', 'insured_email',
  'property_address', 'date_of_loss', 'loss_type', 'claim_description',
  'special_instructions', 'sum_insured_building', 'excess_building',
  'adjuster_reference', 'wo_type', 'order_sender_name', 'order_sender_email',
] as const

const FREE_MAIL = /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|bigpond|iinet|optusnet|westnet|aol|protonmail)\./i

export const ORDER_LIKENESS: Likeness = {
  weights: { sender_email: 4, sender_domain: 3, insurer: 2, subject: 1.5 },
  text: ['subject'],
  minScore: 2,
}

/** Who sent the order and about what — known when the email is parsed */
export function orderSituation(about: { fromEmail?: string | null; fromName?: string | null; subject?: string | null; insurer?: string | null }): Situation {
  const email = about.fromEmail?.trim().toLowerCase() || null
  const domain = email?.split('@')[1] ?? null
  return {
    sender_email: email,
    sender_name: about.fromName?.trim() || null,
    sender_domain: domain && !FREE_MAIL.test(domain) ? domain : null,
    insurer: about.insurer?.trim() || null,
    subject: about.subject?.trim() || null,
  }
}

export function orderSituationText(s: Situation): string {
  const who = s.sender_name && s.sender_email ? `${s.sender_name} <${s.sender_email}>` : s.sender_email ?? s.sender_name ?? 'someone'
  return `Order email from ${who}${s.insurer ? ` (${s.insurer})` : ''}${s.subject ? ` — "${s.subject}"` : ''}`
}

/** What the parser reads before parsing: lessons, then the most alike past orders. '' when there's nothing yet */
export async function orderLearning(db: SupabaseClient, tenantId: string, situation: Situation): Promise<string> {
  const [lessons, cases] = await Promise.all([
    activeLessons(db, tenantId, FEATURE),
    similarCases(db, { tenantId, feature: FEATURE, situation, likeness: ORDER_LIKENESS }),
  ])
  return [formatLessons(lessons), formatCases(cases)].filter(Boolean).join('\n\n')
}

const shown = (v: unknown) => {
  if (v === undefined || v === null || String(v).trim() === '') return '(nothing)'
  const s = String(v).trim()
  return `"${s.length > 200 ? `${s.slice(0, 200)}…` : s}"`
}
/** Equal as the office would see them: case, spacing and number formatting aside */
const norm = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim().replace(/\s+/g, ' ').toLowerCase().replace(/\.0+$/, '')

const AI_NAMES: Partial<Record<string, string>> = { wo_type: 'work_order_type' }

/** Plain lines for each field the office corrected */
export function compareOrder(parsed: Record<string, unknown>, lodged: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const f of ORDER_FIELDS) {
    // The raw parse calls the work type work_order_type
    const key = f in parsed ? f : AI_NAMES[f]
    // Only what the AI read (it returns every field it looked for, null when not found)
    if (!key || !(key in parsed)) continue
    // As the parser stored it: loss and work types mapped to the app's lists
    const ai = f === 'loss_type' ? normaliseLossType(parsed[key]) ?? parsed[key] : f === 'wo_type' && typeof parsed[key] === 'string' ? mapWorkOrderType(parsed[key] as string) : parsed[key]
    if (norm(ai) === norm(lodged[f])) continue
    out.push(`${f.replace(/_/g, ' ')}: the AI read ${shown(ai)}, the office lodged ${shown(lodged[f])}`)
  }
  return out
}

type OrderRow = Record<string, unknown> & {
  id: string
  tenant_id: string
  entry_method: string | null
  gemini_output: unknown
  situation: Situation | null
  order_sender_email: string | null
  order_sender_name: string | null
  raw_email_subject: string | null
  insurer: string | null
}

/**
 * Records what the office did with the AI's parse when an order is lodged.
 * Orders typed in by hand (no parse) aren't recorded. Never throws.
 */
export async function recordOrderLodged(db: SupabaseClient, order: OrderRow, userId: string | null): Promise<void> {
  const parsed = order.gemini_output && typeof order.gemini_output === 'object' ? order.gemini_output as Record<string, unknown> : null
  if (order.entry_method !== 'email' || !parsed) return
  const situation = order.situation ?? orderSituation({ fromEmail: order.order_sender_email, fromName: order.order_sender_name, subject: order.raw_email_subject, insurer: order.insurer })
  if (!situation.insurer && order.insurer) situation.insurer = order.insurer
  const changes = compareOrder(parsed, order)
  await recordLearning(db, {
    tenantId: order.tenant_id,
    feature: FEATURE,
    sourceTable: 'insurer_orders',
    sourceId: order.id,
    situation,
    situationText: orderSituationText(situation),
    proposed: Object.fromEntries(ORDER_FIELDS.map(f => [f, f in parsed ? parsed[f] : parsed[AI_NAMES[f] ?? f]]).filter(([, v]) => v !== undefined)),
    final: Object.fromEntries(ORDER_FIELDS.map(f => [f, order[f] ?? null])),
    changes,
    outcome: changes.length ? 'edited' : 'accepted',
    kind: order.insurer ?? null,
    userId,
  })
}
