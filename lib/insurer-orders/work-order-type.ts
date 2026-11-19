// The work an insurer's order asks for. One order can ask for several things
// at once (Castle often sends "make safe and BAR" or "BAR and roof report" in
// one email), so an order holds a list: insurer_orders.wo_types. The database
// keeps wo_type (the main one) and is_make_safe in step with the list for the
// readers that only need one (scheduling, badges) — see the
// 20261129_order_work_types migration.
//
// Used by the parser (lib/email/order-parser.ts), learning
// (lib/insurer-orders/learning.ts), lodging, the acknowledgement and the
// order screens. Client-safe.

/** Every work type an order can ask for, in the order the acknowledgement lists them */
export const WORK_TYPES = ['make_safe', 'BAR', 'roof_report', 'leak_detection', 'specialist', 'quote_only'] as const
export type WorkType = (typeof WORK_TYPES)[number]

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  make_safe: 'Make Safe',
  BAR: 'BAR',
  roof_report: 'Roof Report',
  leak_detection: 'Leak Detection',
  specialist: 'Specialist Report',
  quote_only: 'Quote Only',
}

/** How each type reads in a sentence ("a make safe and a building assessment report") */
export const WORK_TYPE_PHRASES: Record<WorkType, string> = {
  make_safe: 'make safe',
  BAR: 'building assessment report',
  roof_report: 'roof report',
  leak_detection: 'leak detection',
  specialist: 'specialist report',
  quote_only: 'quote',
}

/** The types done as a requested service — in-house or by a trade — rather than the BAR inspection or a quote */
export const SERVICE_WORK_TYPES = ['make_safe', 'roof_report', 'leak_detection', 'specialist'] as const
export type ServiceWorkType = (typeof SERVICE_WORK_TYPES)[number]

export function isWorkType(v: unknown): v is WorkType {
  return typeof v === 'string' && (WORK_TYPES as readonly string[]).includes(v)
}

export function isServiceWorkType(v: unknown): v is ServiceWorkType {
  return typeof v === 'string' && (SERVICE_WORK_TYPES as readonly string[]).includes(v)
}

/**
 * One piece of the parser's wording as a work type: "Make Safe" → make_safe,
 * "Building Assessment Report" → BAR, "Quote Only" → quote_only. Anything not
 * recognised comes back as written so the office sees it and can fix it.
 */
export function mapWorkOrderType(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (isWorkType(trimmed)) return trimmed
  const lower = trimmed.toLowerCase().replace(/[_-]+/g, ' ')
  if (/make\s*safe|makesafe/.test(lower)) return 'make_safe'
  if (/leak/.test(lower)) return 'leak_detection'
  if (/roof/.test(lower)) return 'roof_report'
  if (/specialist/.test(lower)) return 'specialist'
  if (/quote/.test(lower) && !/\bbar\b|assessment/.test(lower)) return 'quote_only'
  if (/\bbar\b|building assessment|assessment report/.test(lower)) return 'BAR'
  return trimmed
}

/**
 * Everything an order asks for, from the parser's list (or a single
 * string such as "Make Safe and BAR"), mapped and without repeats, in
 * WORK_TYPES order. Unrecognised wording is kept at the end.
 */
export function mapWorkOrderTypes(raw: unknown): string[] {
  const pieces: string[] = []
  const add = (v: unknown) => {
    if (typeof v !== 'string' || !v.trim()) return
    // "Make Safe & BAR", "BAR + Roof Report", "make safe, BAR and quote".
    // Wording that isn't a list of known types ("Roof and gutter report") is
    // kept whole rather than cut into pieces.
    const parts = v.split(/\s*(?:,|\+|&|;|\band\b)\s*/i).map(p => mapWorkOrderType(p)).filter((p): p is string => !!p)
    const known = parts.filter(isWorkType)
    if (parts.length > 1 && known.length) pieces.push(...known)
    else {
      const whole = mapWorkOrderType(v)
      if (whole) pieces.push(whole)
    }
  }
  if (Array.isArray(raw)) raw.forEach(add)
  else add(raw)
  return sortWorkTypes(pieces)
}

/** Without repeats, in WORK_TYPES order; anything unrecognised last */
export function sortWorkTypes(types: readonly string[]): string[] {
  const unique = [...new Set(types.filter(t => typeof t === 'string' && t.trim()))]
  const rank = (t: string) => {
    const i = (WORK_TYPES as readonly string[]).indexOf(t)
    return i < 0 ? WORK_TYPES.length : i
  }
  return unique.sort((a, b) => rank(a) - rank(b))
}

/** The main type, as the database keeps it in wo_type (public.primary_work_type): BAR first */
export function primaryWorkType(types: readonly string[]): string | null {
  const order = ['BAR', 'make_safe', 'roof_report', 'leak_detection', 'specialist', 'quote_only']
  const rank = (t: string) => (order.includes(t) ? order.indexOf(t) : order.length)
  return [...types].sort((a, b) => rank(a) - rank(b))[0] ?? null
}

/** The types on an order that aren't in WORK_TYPES */
export function unknownWorkTypes(types: readonly string[] | null | undefined): string[] {
  return (types ?? []).filter(t => !isWorkType(t))
}

/** An order's work types: the list, else the old single wo_type (orders saved before the list) */
export function orderWorkTypes(order: { wo_types?: readonly string[] | null; wo_type?: string | null }): string[] {
  if (order.wo_types && order.wo_types.length) return sortWorkTypes(order.wo_types)
  const single = mapWorkOrderType(order.wo_type)
  return single ? [single] : []
}

/** "Make Safe + BAR" — for badges and lists */
export function workTypesLabel(types: readonly string[] | null | undefined): string {
  return sortWorkTypes(types ?? []).map(t => (isWorkType(t) ? WORK_TYPE_LABELS[t] : t)).join(' + ')
}

/** "a make safe and a building assessment report" — for sentences */
export function workTypesPhrase(types: readonly string[] | null | undefined): string {
  const phrases = sortWorkTypes(types ?? []).map(t => (isWorkType(t) ? WORK_TYPE_PHRASES[t] : t))
  if (!phrases.length) return ''
  const withArticle = phrases.map(p => `${/^[aeiou]/i.test(p) ? 'an' : 'a'} ${p}`)
  if (withArticle.length === 1) return withArticle[0]
  return `${withArticle.slice(0, -1).join(', ')} and ${withArticle[withArticle.length - 1]}`
}
