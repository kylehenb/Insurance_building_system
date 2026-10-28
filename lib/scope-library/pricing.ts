// Which scope library items apply to a job, and at what price — the one rule
// the field app, field submission, the quote editor's search and the voice
// connector all use. Pure functions; lib/scope-library/catalogue.ts loads the
// rows.
//
// Insurer pricing comes from two places:
// - scope_library.insurer_specific: a row only for one insurer (e.g. "Midcity").
//   Empty or "Default" means every insurer.
// - scope_library_overrides: an insurer's own rates (and wording) for a row.

export interface JobInsurer {
  /** The insurer's clients row, when there is one */
  id: string | null
  /** Names the job's insurer goes by (jobs.insurer, client name, trading name) */
  names: string[]
}

export interface LibraryRow {
  id: string
  trade: string | null
  keyword: string | null
  item_description: string | null
  unit: string | null
  labour_per_unit: number | null
  materials_per_unit: number | null
  total_per_unit: number | null
  trade_rate_total: number | null
  estimated_hours: number | null
  insurer_specific: string | null
  approval_status: string | null
}

export interface OverrideRow {
  scope_library_id: string
  insurer_id: string
  labour_per_unit: number | null
  materials_per_unit: number | null
  total_per_unit: number | null
  wording_single: string | null
}

/** A library item as offered on one job: its wording and rates for that job's insurer. */
export interface CatalogueItem {
  id: string
  trade: string | null
  keyword: string | null
  item_description: string
  unit: string | null
  rate_labour: number | null
  rate_materials: number | null
  trade_rate_total: number | null
  estimated_hours: number | null
  /** The insurer this item or its price is specific to; null for the standard item */
  insurer_specific: string | null
  /** Saved from a quote and not yet approved in the scope library */
  pending: boolean
}

const squash = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** An insurer_specific value that means "every insurer" */
export function isStandardTag(tag: string | null | undefined): boolean {
  const t = squash(tag)
  return !t || t === 'default'
}

/** Whether a row tagged for an insurer applies to the job's insurer ("Midcity" matches "Midcity Insurance"). */
export function insurerTagMatches(tag: string | null | undefined, insurer: JobInsurer | null): boolean {
  if (isStandardTag(tag)) return true
  const t = squash(tag)
  return (insurer?.names ?? []).some(name => {
    const n = squash(name)
    return !!n && (n === t || n.startsWith(t) || t.startsWith(n))
  })
}

/**
 * Labour and materials for a line from library prices. A row with only a
 * total (no split) puts it all on labour so the line still totals right.
 */
export function splitRates(labour: number | null, materials: number | null, total: number | null) {
  if (labour == null && materials == null && total != null) return { rate_labour: total, rate_materials: 0 }
  return { rate_labour: labour, rate_materials: materials }
}

/**
 * The library items a job can pick from, priced for its insurer: archived rows
 * and other insurers' rows left out, the insurer's override rates and wording
 * applied, and a standard row dropped where the insurer has its own row with
 * the same keyword. Insurer-specific items first, then by trade and wording.
 */
export function buildCatalogue(rows: LibraryRow[], overrides: OverrideRow[], insurer: JobInsurer | null): CatalogueItem[] {
  const live = rows.filter(r => r.approval_status !== 'archived' && r.item_description?.trim() && insurerTagMatches(r.insurer_specific, insurer))
  const ownKeywords = new Set(live.filter(r => !isStandardTag(r.insurer_specific) && squash(r.keyword)).map(r => squash(r.keyword)))
  const overrideFor = new Map(
    overrides.filter(o => insurer?.id && o.insurer_id === insurer.id).map(o => [o.scope_library_id, o]),
  )

  return live
    .filter(r => !(isStandardTag(r.insurer_specific) && squash(r.keyword) && ownKeywords.has(squash(r.keyword))))
    .map((r): CatalogueItem => {
      const o = overrideFor.get(r.id)
      const hasOverridePrice = !!o && (o.labour_per_unit != null || o.materials_per_unit != null || o.total_per_unit != null)
      const rates = hasOverridePrice
        ? splitRates(o!.labour_per_unit, o!.materials_per_unit, o!.total_per_unit)
        : splitRates(r.labour_per_unit, r.materials_per_unit, r.total_per_unit)
      const tag = isStandardTag(r.insurer_specific) ? null : r.insurer_specific!.trim()
      const insurerLabel = tag ?? (o ? insurer?.names[0] ?? null : null)
      return {
        id: r.id,
        trade: r.trade?.trim() || null,
        keyword: r.keyword?.trim() || null,
        item_description: (o?.wording_single?.trim() || r.item_description!).trim(),
        unit: normaliseUnit(r.unit),
        ...rates,
        trade_rate_total: r.trade_rate_total,
        estimated_hours: r.estimated_hours,
        insurer_specific: insurerLabel,
        pending: r.approval_status === 'pending',
      }
    })
    .sort((a, b) =>
      (a.insurer_specific ? 0 : 1) - (b.insurer_specific ? 0 : 1) ||
      (a.trade ?? '').localeCompare(b.trade ?? '') ||
      a.item_description.localeCompare(b.item_description))
}

const UNIT_ALIASES: Record<string, string> = {
  m2: 'm²', 'm²': 'm²', sqm: 'm²', m3: 'm³', 'm³': 'm³',
  lm: 'lm', l: 'lm', lin: 'lm', linealmetre: 'lm', linealmeter: 'lm', m: 'lm',
  ea: 'ea', each: 'ea', unit: 'ea', units: 'ea', item: 'ea', items: 'ea', no: 'ea', nr: 'ea',
  hr: 'hr', hrs: 'hr', hour: 'hr', hours: 'hr', set: 'set', sets: 'set',
}

/** A unit as the quote editor offers them (m², m³, lm, ea, hr, set): "Each" → "ea", "m2" → "m²". Anything else as given. */
export function normaliseUnit(unit: string | null | undefined): string | null {
  const u = (unit ?? '').trim()
  if (!u) return null
  return UNIT_ALIASES[u.toLowerCase().replace(/[\s.]/g, '')] ?? u
}

function formatQty(qty: number): string {
  return String(Math.round(qty * 100) / 100)
}

/**
 * Puts the quantity into a library description's {QTY} placeholders, e.g.
 * "Paint ceiling. [{QTY}.0m2]" at 9 → "Paint ceiling. [9.0m2]" (at 9.5 →
 * "[9.5m2]"). Left as it is without a quantity.
 */
export function fillQuantity(description: string, qty: number | null | undefined): string {
  if (qty == null || !Number.isFinite(qty)) return description
  const n = formatQty(qty)
  return description
    .replace(/\{QTY\}\.0/gi, Number.isInteger(qty) ? `${n}.0` : n)
    .replace(/\{QTY\}/gi, n)
}

/**
 * A library description for reading on a phone, without its {QTY}
 * placeholders: "Paint ceiling. [{QTY}.0m2]" → "Paint ceiling.",
 * "cornice ({QTY} walls)" → "cornice (# walls)". The quote still gets the
 * full wording with the quantity filled in.
 */
export function displayWording(description: string): string {
  return description
    .replace(/\s*\[[^\]]*\{QTY\}[^\]]*\]/gi, '')
    .replace(/\{QTY\}/gi, '#')
    .trim()
}

/** A quantity typed in the field ("9", "2.5", "13 lm") as a number, or null */
export function parseQty(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const m = value.replace(',', '.').match(/-?\d+(\.\d+)?/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}
