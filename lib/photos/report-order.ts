// Report photo order: every report opens with one front view of the property,
// then the mud map / floor plan photos (as many as there are), then the rest in
// the order the inspector took them. The two lead labels are fixed wording so
// the report reads the same every time.

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

/**
 * The photos in report order: the first "View of Property", then every "Mud Map/Floor Plan",
 * then everything else in its existing order. Only one photo can lead as the view — a second
 * one labelled that way stays where it was among the rest.
 */
export function orderReportPhotos<T extends { label: string | null }>(photos: T[]): T[] {
  const viewIndex = photos.findIndex(p => photoKindOfLabel(p.label) === 'view_of_property')
  const view = viewIndex >= 0 ? [photos[viewIndex]] : []
  const mudMaps = photos.filter(p => photoKindOfLabel(p.label) === 'mud_map')
  const rest = photos.filter((p, i) => i !== viewIndex && photoKindOfLabel(p.label) !== 'mud_map')
  return [...view, ...mudMaps, ...rest]
}

/** Photos per AI labelling request from the field app: ~125 KB JPEGs, so a batch stays well under Vercel's 4.5 MB request cap */
export const AI_LABEL_BATCH_SIZE = 8

/** What the AI said about one photo (see lib/photos/ai-label.ts). */
export interface AiPhotoLabel {
  kind: PhotoKind
  /** Descriptive "Location - what is shown" label, used when the photo isn't a lead photo */
  label: string
  /** 0–1: how sure the AI is of `kind` */
  confidence: number
}

/**
 * Final labels for a set of photos from the AI's reading of each. Mud maps get the fixed mud map
 * label; of the photos the AI thinks show the front of the property, only the surest becomes
 * "View of Property" (none if a kept label already is one) and the others keep their descriptive
 * label. With keepExisting, photos that already have a label keep it.
 */
export function applyAiLabels(
  existing: (string | null)[],
  ai: (AiPhotoLabel | null)[],
  { keepExisting }: { keepExisting: boolean },
): string[] {
  const kept = (i: number) => keepExisting && !!existing[i]?.trim()
  const viewTaken = existing.some((l, i) => kept(i) && photoKindOfLabel(l) === 'view_of_property')

  let viewIndex = -1
  if (!viewTaken) {
    ai.forEach((a, i) => {
      if (kept(i) || a?.kind !== 'view_of_property') return
      if (viewIndex < 0 || a.confidence > (ai[viewIndex]?.confidence ?? 0)) viewIndex = i
    })
  }

  return existing.map((label, i) => {
    const a = ai[i]
    if (kept(i) || !a) return label ?? ''
    if (i === viewIndex) return VIEW_OF_PROPERTY_LABEL
    if (a.kind === 'mud_map') return MUD_MAP_LABEL
    // A second front view, or the AI used a lead label for an ordinary photo: keep it descriptive
    return photoKindOfLabel(a.label) === 'other' ? a.label : label ?? ''
  })
}
