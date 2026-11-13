// The roof report's review list (Midcity field app): after the AI writes the
// report, only the fields worth a look are shown first, each marked why:
//   empty   nothing filled in (and the field is needed)
//   check   the AI said it guessed or inferred it rather than read it in the notes
//   always  reviewed every time: the specific cause and the maintenance
// Everything else stays a tap away ("All fields"). Safe to import in the browser.

export type ReviewFlag = 'empty' | 'check' | 'always'

/** Always reviewed, whatever's in them */
export const ALWAYS_REVIEW = ['specificCause', 'requiredMaintenanceDetails', 'recommendedMaintenanceDetails'] as const

/** Filled in by the report itself, not by the inspector — never flagged (page one's summary is written from the cause of damage) */
const NOT_REVIEWED = new Set(['claimDetails', 'rooferName', 'rooferQualification', 'attendanceDate', 'timeAttended', 'causeSummary', 'problemSummaries'])

/** Detail boxes only needed for one answer of their question (e.g. gutter notes when the gutters aren't compliant) */
const DETAIL_FOR: Record<string, { field: string; when: string }> = {
  skylightFlashingsNotes: { field: 'skylightFlashingsWatertight', when: 'No' },
  guttersNotes: { field: 'guttersCompliant', when: 'No' },
  propertyConditionsDetails: { field: 'propertyConditionsContributed', when: 'Yes' },
  damageWithoutConditionsDetails: { field: 'damageWithoutConditions', when: 'Yes' },
  customerAwareDetails: { field: 'customerAwareOfConditions', when: 'Yes' },
  otherPropertyConditionDetails: { field: 'otherPropertyConditionIssues', when: 'Yes' },
  conditionsPreventRepairsDetails: { field: 'conditionsPreventRepairs', when: 'Yes' },
  previousRepairsDetails: { field: 'previousRepairs', when: 'Yes' },
  buildingCodeViolationsDetails: { field: 'buildingCodeViolations', when: 'Yes' },
  makeSafeCompletedDetails: { field: 'makeSafeCompleted', when: 'Yes' },
}

/** Field keys the AI listed as guessed, kept to known fields */
export function cleanUncertain(value: unknown, fields: Record<string, unknown>): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((k): k is string => typeof k === 'string' && k in fields && !NOT_REVIEWED.has(k)))]
}

/** Why each field needs a look; fields not in the map are fine as they are. */
export function reviewFlags(fields: Record<string, string>, uncertain: string[] = []): Map<string, ReviewFlag> {
  const out = new Map<string, ReviewFlag>()
  const unsure = new Set(uncertain)
  for (const [key, value] of Object.entries(fields)) {
    if (NOT_REVIEWED.has(key)) continue
    if ((ALWAYS_REVIEW as readonly string[]).includes(key)) { out.set(key, 'always'); continue }
    const detail = DETAIL_FOR[key]
    if (detail && fields[detail.field] !== detail.when) continue // not needed for the answer given
    if (!String(value ?? '').trim()) out.set(key, 'empty')
    else if (unsure.has(key)) out.set(key, 'check')
  }
  return out
}
