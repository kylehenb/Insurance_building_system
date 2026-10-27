// Report photo order: every report opens with one front view of the property,
// then the mud map / floor plan photos (as many as there are), then the rest
// grouped room by room in the order the inspector walked through the house.
// The two lead labels are fixed wording so the report reads the same every
// time. Safe to import in the browser (no SDKs here).

export const VIEW_OF_PROPERTY_LABEL = 'View of Property'
export const MUD_MAP_LABEL = 'Mud Map/Floor Plan'

export type PhotoKind = 'view_of_property' | 'mud_map' | 'other'

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Which lead slot a label belongs to. Ignores case, spacing and punctuation ("Mud map / floor plan 2" counts). */
export function photoKindOfLabel(label: string | null | undefined): PhotoKind {
  const s = squash(label ?? '')
  if (s === squash(VIEW_OF_PROPERTY_LABEL)) return 'view_of_property'
  if (s.startsWith(squash(MUD_MAP_LABEL))) return 'mud_map'
  return 'other'
}

/** The lead photos (the first "View of Property", then every "Mud Map/Floor Plan") and the rest, each in existing order. */
function splitLeads<T extends { label: string | null }>(photos: T[]): { head: T[]; rest: T[] } {
  const viewIndex = photos.findIndex(p => photoKindOfLabel(p.label) === 'view_of_property')
  const isMudMap = (p: T) => photoKindOfLabel(p.label) === 'mud_map'
  return {
    head: [...(viewIndex >= 0 ? [photos[viewIndex]] : []), ...photos.filter(isMudMap)],
    rest: photos.filter((p, i) => i !== viewIndex && !isMudMap(p)),
  }
}

/**
 * The photos in report order: the first "View of Property", then every "Mud Map/Floor Plan",
 * then everything else in its existing order. Only one photo can lead as the view — a second
 * one labelled that way stays where it was among the rest.
 */
export function orderReportPhotos<T extends { label: string | null }>(photos: T[]): T[] {
  const { head, rest } = splitLeads(photos)
  return [...head, ...rest]
}

/** Photos per AI labelling batch: neighbours give the AI room context, and a batch stays a quick call */
export const AI_LABEL_BATCH_SIZE = 8

/** Below this the field app highlights a label for the inspector to check */
export const LOW_CONFIDENCE = 0.6

/** What the AI said about one photo (see lib/photos/ai-label.ts). */
export interface AiPhotoLabel {
  kind: PhotoKind
  /** Descriptive "Location - what is shown" label, used when the photo isn't a lead photo */
  label: string
  /** 0–1: how sure the AI is of `kind` */
  confidence: number
  /** One sentence: what is visible */
  seen?: string
  /** Room or area, e.g. "Kitchen", "External", "" when it can't tell */
  room?: string
  /** 0–1: how sure the AI is of `room` */
  roomConfidence?: number
}

/**
 * Final labels for a set of photos from the AI's reading of each. Mud maps get the fixed mud map
 * label; of the photos the AI thinks show the front of the property, only the surest becomes
 * "View of Property" (none if a kept label already is one) and the others keep their descriptive
 * label. Photos with `keep` set (the inspector's own labels) keep theirs.
 */
export function applyAiLabels(
  existing: (string | null)[],
  ai: (AiPhotoLabel | null)[],
  { keep }: { keep: (i: number) => boolean },
): string[] {
  const viewTaken = existing.some((l, i) => keep(i) && photoKindOfLabel(l) === 'view_of_property')

  let viewIndex = -1
  if (!viewTaken) {
    ai.forEach((a, i) => {
      if (keep(i) || a?.kind !== 'view_of_property') return
      if (viewIndex < 0 || a.confidence > (ai[viewIndex]?.confidence ?? 0)) viewIndex = i
    })
  }

  return existing.map((label, i) => {
    const a = ai[i]
    if (keep(i) || !a) return label ?? ''
    if (i === viewIndex) return VIEW_OF_PROPERTY_LABEL
    if (a.kind === 'mud_map') return MUD_MAP_LABEL
    // A second front view, or the AI used a lead label for an ordinary photo: keep it descriptive
    return photoKindOfLabel(a.label) === 'other' ? a.label : label ?? ''
  })
}

/** The room part of a "Room - what is shown" label ("" when there isn't one). */
export function roomOfLabel(label: string | null | undefined): string {
  const m = (label ?? '').match(/^\s*([^-–—]+?)\s+[-–—]\s+/)
  return m ? m[1].trim() : ''
}

/** Below this the AI's room isn't trusted enough to move a photo away from the ones around it */
const ROOM_GROUPING_CONFIDENCE = 0.6

/**
 * Report order with the rest grouped by room: View of Property, mud maps, then each room's photos
 * together, rooms in the order they were first photographed (the walk-through), photos within a
 * room in the order taken. A photo whose room isn't known (or the AI isn't sure of) stays with the
 * photos taken just before it, so a close-up never drifts away from its wide shot.
 */
export function groupPhotosForReport<T extends { label: string | null; room?: string | null; roomConfidence?: number | null }>(photos: T[]): T[] {
  const { head, rest } = splitLeads(photos)

  const keyOf = (p: T): string => {
    const room = (p.room ?? '').trim()
    if (room && (p.roomConfidence ?? 1) >= ROOM_GROUPING_CONFIDENCE) return squash(room)
    return ''
  }
  // Unknown rooms inherit the room of the photo before them (or after, for the first ones)
  const keys = rest.map(keyOf)
  for (let i = 1; i < keys.length; i++) if (!keys[i]) keys[i] = keys[i - 1]
  for (let i = keys.length - 2; i >= 0; i--) if (!keys[i]) keys[i] = keys[i + 1]

  const order: string[] = []
  const groups = new Map<string, T[]>()
  rest.forEach((p, i) => {
    const k = keys[i] || `#${i}` // nothing known at all: keep it where it is
    if (!groups.has(k)) { groups.set(k, []); order.push(k) }
    groups.get(k)!.push(p)
  })
  return [...head, ...order.flatMap(k => groups.get(k)!)]
}
