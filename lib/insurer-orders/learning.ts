import type { SupabaseClient } from '@supabase/supabase-js'
import { activeLessons, formatLessons } from '@/lib/learning/lessons'
import { formatCases, recordLearning, similarCases, type Likeness, type Situation } from '@/lib/learning/events'
import { normaliseLossType } from '@/lib/loss-types'
import { mapWorkOrderTypes, orderWorkTypes, workTypesLabel } from './work-order-type'

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
  'adjuster_reference', 'wo_types', 'order_sender_name', 'order_sender_email',
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

/** What the raw parse calls a field: the work types are work_order_types (older prompts: work_order_type) */
function aiKey(parsed: Record<string, unknown>, f: string): string | undefined {
  if (f in parsed) return f
  if (f === 'wo_types') return ['work_order_types', 'work_order_type', 'wo_type'].find(k => k in parsed)
  return undefined
}

/** Plain lines for each field the office corrected */
export function compareOrder(parsed: Record<string, unknown>, lodged: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const f of ORDER_FIELDS) {
    const key = aiKey(parsed, f)
    // Only what the AI read (it returns every field it looked for, null when not found)
    if (!key) continue
    if (f === 'wo_types') {
      // The same types in any order are the same; shown as "Make Safe + BAR"
      const ai = workTypesLabel(mapWorkOrderTypes(parsed[key]))
      const office = workTypesLabel(orderWorkTypes(lodged as { wo_types?: string[] | null; wo_type?: string | null }))
      if (norm(ai) !== norm(office)) out.push(`work types: the AI read ${shown(ai)}, the office lodged ${shown(office)}`)
      continue
    }
    // As the parser stored it: loss types mapped to the app's list
    const ai = f === 'loss_type' ? normaliseLossType(parsed[key]) ?? parsed[key] : parsed[key]
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
    proposed: Object.fromEntries(ORDER_FIELDS.map(f => { const k = aiKey(parsed, f); return [f, k ? parsed[k] : undefined] }).filter(([, v]) => v !== undefined)),
    final: Object.fromEntries(ORDER_FIELDS.map(f => [f, f === 'wo_types' ? orderWorkTypes(order as { wo_types?: string[] | null; wo_type?: string | null }) : order[f] ?? null])),
    changes,
    outcome: changes.length ? 'edited' : 'accepted',
    kind: order.insurer ?? null,
    userId,
  })
}
