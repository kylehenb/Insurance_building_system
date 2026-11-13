// Bindi Co's field app keeps two sets of photos for one inspection, both through
// the same uploader (app/field/[inspectionId]/useFieldPhotos.ts): the roof
// report's, and the make safe report's. A make safe photo's client id starts
// with "ms", so each list picks up only its own, and the server leaves make safe
// photos out of the AI sorting (that's for roof report tags). Roof photos (and
// the IRC field app's) start with "p". Safe to import in the browser.

export type PhotoSet = 'main' | 'makesafe'

export const MAKE_SAFE_ID_PREFIX = 'ms'

export const isMakeSafePhotoId = (clientId: string | null | undefined): boolean => !!clientId?.startsWith(MAKE_SAFE_ID_PREFIX)

/** Whether a photo (by client id) belongs in a set */
export const inPhotoSet = (clientId: string | null | undefined, set: PhotoSet): boolean =>
  set === 'makesafe' ? isMakeSafePhotoId(clientId) : !isMakeSafePhotoId(clientId)

// ── Make safe photo labels ─────────────────────────────────────────────────
// One-tap Before / After (the make safe report shows what was there and what
// was done), and an optional note: "Before", "After - tarp over rear valley",
// or just a note. Kept as one string like any photo label.

export const MAKE_SAFE_STAGES = ['Before', 'After'] as const
export type MakeSafeStage = (typeof MAKE_SAFE_STAGES)[number]

/** The stage and note in a make safe photo's label */
export function parseMakeSafeLabel(label: string | null | undefined): { stage: MakeSafeStage | null; note: string } {
  // Only leading space is dropped, so a note being typed keeps the space before its next word
  const text = (label ?? '').replace(/^\s+/, '')
  const m = text.match(/^(before|after)\b(?:\s*[-–—:]\s*|\s+|$)([\s\S]*)$/i)
  if (!m) return { stage: null, note: text }
  return { stage: (m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()) as MakeSafeStage, note: m[2] }
}

/** The label for a stage and note */
export const composeMakeSafeLabel = (stage: MakeSafeStage | null, note = ''): string => {
  const n = note.replace(/^\s+/, '')
  return stage ? (n.trim() ? `${stage} - ${n}` : stage) : n
}
