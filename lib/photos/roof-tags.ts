// Roof report photo tags (Midcity's field app). A roof photo's label is one tag
// and an optional note, kept as one string so it saves like any photo label:
//   "(A)", "(A) cracked ridge pointing"  → problem A from the cause of damage
//   "Gutter Profile", "Gutter Profile - 115mm quad"  → one of the fixed types
//   "", "loose screw"  → nothing: the report shows just the photo number (and the note)
// Problem letters are colour coded, the same colour in the report text and on
// the photo's pill. The AI only ever picks a tag; it never writes a note.
// Safe to import in the browser.

import { VIEW_OF_PROPERTY_LABEL } from './report-order'

export const ROOF_TAGS = [
  { key: 'view_of_property', label: VIEW_OF_PROPERTY_LABEL, chip: 'Front' },
  { key: 'roof_overview', label: 'Roof Overview', chip: 'Overview' },
  { key: 'ladder_setup', label: 'Ladder Setup', chip: 'Ladder' },
  { key: 'gutter_profile', label: 'Gutter Profile', chip: 'Gutter' },
  { key: 'downpipe_profile', label: 'Downpipe Profile', chip: 'Downpipe' },
  { key: 'safety_apparatus', label: 'Safety Apparatus', chip: 'Safety' },
] as const

export type RoofTagKey = (typeof ROOF_TAGS)[number]['key']

export const ISSUE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const

/** Strong colours that read on white and carry white text, kept apart from each other */
const ISSUE_COLOURS: Record<string, string> = {
  A: '#1f5fa8', // blue
  B: '#c62828', // red
  C: '#2e7d32', // green
  D: '#b8600b', // orange
  E: '#6a3d9a', // purple
  F: '#00838f', // teal
  G: '#ad1457', // pink
  H: '#5d4037', // brown
}

export const issueColour = (letter: string): string => ISSUE_COLOURS[letter] ?? '#555555'

export type RoofPhotoTag =
  | { kind: 'issue'; letter: string }
  | { kind: 'type'; key: RoofTagKey }
  | { kind: 'none' }

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const ISSUE_AT_START = /^\s*\(([A-H])\)\s*/

/** The tag and note in a roof photo label. */
export function parseRoofLabel(label: string | null | undefined): { tag: RoofPhotoTag; note: string } {
  const text = (label ?? '').trim()
  const issue = text.match(ISSUE_AT_START)
  if (issue) return { tag: { kind: 'issue', letter: issue[1] }, note: text.slice(issue[0].length).trim() }
  for (const t of ROOF_TAGS) {
    // "Gutter Profile", or "Gutter Profile - note"
    const m = text.match(/^(.+?)(?:\s+[-–—]\s+(.*))?$/)
    if (m && squash(m[1]) === squash(t.label)) return { tag: { kind: 'type', key: t.key }, note: (m[2] ?? '').trim() }
  }
  return { tag: { kind: 'none' }, note: text }
}

/** The label for a tag and note. */
export function composeRoofLabel(tag: RoofPhotoTag, note = ''): string {
  const n = note.trim()
  if (tag.kind === 'issue') return n ? `(${tag.letter}) ${n}` : `(${tag.letter})`
  if (tag.kind === 'type') {
    const t = ROOF_TAGS.find(x => x.key === tag.key)!
    return n ? `${t.label} - ${n}` : t.label
  }
  return n
}

export const sameTag = (a: RoofPhotoTag, b: RoofPhotoTag): boolean =>
  a.kind === b.kind && (a.kind !== 'issue' || a.letter === (b as { letter: string }).letter) && (a.kind !== 'type' || a.key === (b as { key: string }).key)

/** The problems in the cause of damage: each letter with the text of its first point. */
export function issuePoints(cause: string | null | undefined): { letter: string; text: string }[] {
  const seen = new Map<string, string>()
  for (const line of (cause ?? '').split('\n')) {
    const body = line.trim().replace(/^[•\-*–]\s*/, '')
    const m = body.match(ISSUE_AT_START)
    if (m && !seen.has(m[1])) seen.set(m[1], body.slice(m[0].length).trim())
  }
  return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([letter, text]) => ({ letter, text }))
}

/** The letters to offer on the phone: the ones in use, one spare, and always at least A–C. */
export function issueLettersToOffer(used: string[]): string[] {
  const highest = Math.max(2, ...used.map(l => ISSUE_LETTERS.indexOf(l as (typeof ISSUE_LETTERS)[number])).filter(i => i >= 0).map(i => i + 1))
  return ISSUE_LETTERS.slice(0, Math.min(ISSUE_LETTERS.length, highest + 1))
}

/**
 * Report order: the front view, then the roof overview, then each problem's photos
 * (A, B, C…), then everything else. Within each group, the order taken.
 */
export function orderRoofPhotos<T extends { label: string | null }>(photos: T[]): T[] {
  const rank = (p: T): number => {
    const { tag } = parseRoofLabel(p.label)
    if (tag.kind === 'type' && tag.key === 'view_of_property') return 0
    if (tag.kind === 'type' && tag.key === 'roof_overview') return 1
    if (tag.kind === 'issue') return 2 + ISSUE_LETTERS.indexOf(tag.letter as (typeof ISSUE_LETTERS)[number])
    return 100
  }
  return photos.map((p, i) => ({ p, i, r: rank(p) })).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.p)
}

/** Text split around "(A)" problem letters, for colouring them. */
export function splitIssueLetters(text: string): Array<{ letter: string | null; text: string }> {
  const out: Array<{ letter: string | null; text: string }> = []
  let last = 0
  for (const m of text.matchAll(/\(([A-H])\)/g)) {
    if (m.index! > last) out.push({ letter: null, text: text.slice(last, m.index) })
    out.push({ letter: m[1], text: m[0] })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ letter: null, text: text.slice(last) })
  return out
}
