import { renderTemplate } from '@/lib/email/templates'
import { WORK_TYPES, isWorkType, sortWorkTypes, unknownWorkTypes, workTypesPhrase, type WorkType } from './work-order-type'

// What the order acknowledgement says we'll do: one line for each thing the
// order asks for, in WORK_TYPES order (make safe first), joined into the
// template's {work_type_lines}. The lines are edited with the template
// (Settings → Email Templates → Order acknowledgement) and saved on it
// (email_templates.work_type_lines); a client's version can change any of
// them, and the rest come from the standard version, then these defaults.
// Each line reads true whether the work is done in-house or by a trade.
// Client-safe: the template editor previews with the same code.

export type WorkTypeLines = Partial<Record<WorkType, string>>

export const DEFAULT_WORK_TYPE_LINES: Record<WorkType, string> = {
  make_safe: 'We will arrange for the property to be made safe as a priority and will update you once it has been completed.',
  BAR: 'We will contact the insured to arrange an appointment and will update you once it has been scheduled.',
  roof_report: 'We will arrange the roof report and update you once it has been scheduled.',
  leak_detection: 'We will arrange the leak detection and update you once it has been scheduled.',
  specialist: 'We will arrange the specialist report and update you once it has been scheduled.',
  quote_only: 'We will prepare the quote and send it through once it is ready.',
}

/** A saved work_type_lines value as lines: known types with text only */
export function readWorkTypeLines(saved: unknown): WorkTypeLines {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
  const out: WorkTypeLines = {}
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    if (isWorkType(k) && typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  return out
}

/** Each type's line: the client's version, else the standard version, else the default */
export function mergeWorkTypeLines(...versions: unknown[]): Record<WorkType, string> {
  const merged = { ...DEFAULT_WORK_TYPE_LINES }
  // Least specific first: defaults ← standard ← client
  for (const v of [...versions].reverse()) Object.assign(merged, readWorkTypeLines(v))
  return merged
}

/** The lines for an order's types, in order, with placeholders filled in. Unknown types have no line. */
export function workTypeLinesFor(types: readonly string[], lines: Record<WorkType, string>, vars: Record<string, string | null | undefined> = {}): string[] {
  return sortWorkTypes(types).filter(isWorkType).map(t => renderTemplate(lines[t], vars).trim()).filter(Boolean)
}

/** The acknowledgement's placeholders for an order's work types */
export function workTypeVars(types: readonly string[], lines: Record<WorkType, string>, vars: Record<string, string | null | undefined> = {}) {
  return {
    work_type_lines: workTypeLinesFor(types, lines, vars).join(' '),
    work_types: workTypesPhrase(types.filter(isWorkType)),
  }
}

/**
 * Why the acknowledgement can't say what we'll do for this order, or null.
 * It's held rather than sent with no line, or a line for the wrong work.
 */
export function workTypesProblem(types: readonly string[]): string | null {
  if (!types.length) return 'The order has no work type, so the acknowledgement wouldn\'t say what we\'ll do — tick what the order asks for'
  const unknown = unknownWorkTypes(types)
  if (unknown.length) return `The order's work type "${unknown.join('", "')}" isn't one the app knows — correct it so the acknowledgement says the right thing`
  return null
}

export { WORK_TYPES }
