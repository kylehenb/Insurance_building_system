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

/** Problem letters: as many as there are problems, A to Z */
export const ISSUE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

/** Strong colours that read on white and carry white text, kept apart from each other; they repeat after L */
const ISSUE_COLOURS = [
  '#1f5fa8', // A blue
  '#c62828', // B red
  '#2e7d32', // C green
  '#b8600b', // D orange
  '#6a3d9a', // E purple
  '#00838f', // F teal
  '#ad1457', // G pink
  '#5d4037', // H brown
  '#283593', // I indigo
  '#6b7a1f', // J olive
  '#455a64', // K slate
  '#8d6e00', // L mustard
]

export const issueColour = (letter: string): string => {
  const i = ISSUE_LETTERS.indexOf(letter)
  return i < 0 ? '#555555' : ISSUE_COLOURS[i % ISSUE_COLOURS.length]
}

export type RoofPhotoTag =
  | { kind: 'issue'; letter: string }
  | { kind: 'type'; key: RoofTagKey }
  | { kind: 'none' }

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const ISSUE_AT_START = /^\s*\(([A-Z])\)\s*/

/** The tag and note in a roof photo label. */
export function parseRoofLabel(label: string | null | undefined): { tag: RoofPhotoTag; note: string } {
  // Only leading space is dropped, so a note being typed keeps the space before its next word
  const text = (label ?? '').replace(/^\s+/, '')
  const issue = text.match(ISSUE_AT_START)
  if (issue) return { tag: { kind: 'issue', letter: issue[1] }, note: text.slice(issue[0].length) }
  for (const t of ROOF_TAGS) {
    // "Gutter Profile", or "Gutter Profile - note"
    const m = text.match(/^(.+?)(?:\s+[-–—]\s+([\s\S]*))?$/)
    if (m && squash(m[1]) === squash(t.label)) return { tag: { kind: 'type', key: t.key }, note: (m[2] ?? '').replace(/^\s+/, '') }
  }
  return { tag: { kind: 'none' }, note: text }
}

/** The label for a tag and note. */
export function composeRoofLabel(tag: RoofPhotoTag, note = ''): string {
  const n = note.replace(/^\s+/, '')
  const has = !!n.trim()
  if (tag.kind === 'issue') return has ? `(${tag.letter}) ${n}` : `(${tag.letter})`
  if (tag.kind === 'type') {
    const t = ROOF_TAGS.find(x => x.key === tag.key)!
    return has ? `${t.label} - ${n}` : t.label
  }
  return has ? n : ''
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
  const highest = Math.max(2, ...used.map(l => ISSUE_LETTERS.indexOf(l)).filter(i => i >= 0).map(i => i + 1))
  return ISSUE_LETTERS.slice(0, Math.min(ISSUE_LETTERS.length, highest + 1))
}

/** Every problem letter in "(A)" form anywhere in some text */
export const lettersIn = (text: string | null | undefined): string[] =>
  [...new Set([...(text ?? '').matchAll(/\(([A-Z])\)/g)].map(m => m[1]))].sort()

/**
 * The one list of problem letters, offered everywhere (photo tags, the overview,
 * a photo's markup): every letter in use anywhere in the report, plus one spare.
 * So a problem added to the cause of damage, or a letter tapped on a photo, shows
 * up everywhere straight away.
 */
export function reportLetters({ cause, causeSummary, problemLines, photoLabels = [], marked = [] }: {
  cause?: string | null
  causeSummary?: string | null
  problemLines?: string | null
  photoLabels?: (string | null | undefined)[]
  /** Letters used in markup */
  marked?: (string | null)[]
}): string[] {
  return issueLettersToOffer([
    ...issuePoints(cause).map(i => i.letter),
    ...lettersIn(causeSummary),
    ...problemSummaries(problemLines, '').map(p => p.letter),
    ...photoLabels.map(l => parseRoofLabel(l).tag).flatMap(t => (t.kind === 'issue' ? [t.letter] : [])),
    ...marked.filter((l): l is string => !!l),
  ])
}

/** The words of some text, for telling a real change from capitals, punctuation or spacing */
const wordsOf = (text: string): string => text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).join(' ')

/**
 * The cause of damage by problem: each letter's points (all of them, in order), and the
 * lead line with the points that aren't about one problem under "", each as its words only.
 */
export function causeByProblem(cause: string | null | undefined): Map<string, string> {
  const parts = new Map<string, string[]>()
  for (const line of (cause ?? '').split('\n')) {
    const body = line.trim().replace(/^[•\-*–]\s*/, '')
    if (!body) continue
    const m = body.match(ISSUE_AT_START)
    const key = m ? m[1] : ''
    parts.set(key, [...(parts.get(key) ?? []), wordsOf(m ? body.slice(m[0].length) : body)])
  }
  return new Map([...parts].map(([k, v]) => [k, v.filter(Boolean).join(' | ')]))
}

export interface PageOneStep {
  /** Problems in the cause that page one doesn't mention */
  missing: string[]
  /** Letters on page one no longer in the cause */
  gone: string[]
  /** Problems whose wording in the cause has changed since page one was written */
  changed: string[]
  /** The cause's lead line, or its points that aren't about one problem, have changed */
  otherChanged: boolean
}

/**
 * Where page one has fallen out of step with the cause of damage (after the cause
 * was edited). No AI: plain text matching on the "(A)" letters, and, given the cause
 * as it was when page one was last written (`basis`), a word-by-word comparison of
 * each problem's points. Any change to the words counts; changes only to capitals,
 * punctuation or spacing don't. Nothing when page one hasn't been written.
 */
export function pageOneOutOfStep(cause: string | null | undefined, causeSummary: string | null | undefined, problemLines: string | null | undefined, basis?: string | null): PageOneStep {
  const none: PageOneStep = { missing: [], gone: [], changed: [], otherChanged: false }
  if (!causeSummary?.trim() && !problemLines?.trim()) return none
  const inCause = issuePoints(cause).map(i => i.letter)
  const summary = lettersIn(causeSummary)
  const lines = problemSummaries(problemLines, '').map(p => p.letter)
  const missing = new Set<string>()
  if (causeSummary?.trim()) for (const l of inCause) if (!summary.includes(l)) missing.add(l)
  if (problemLines?.trim()) for (const l of inCause) if (!lines.includes(l)) missing.add(l)
  const gone = [...new Set([...summary, ...lines])].filter(l => inCause.length && !inCause.includes(l))
  const changed: string[] = []
  let otherChanged = false
  if (typeof basis === 'string') {
    const then = causeByProblem(basis), now = causeByProblem(cause)
    for (const l of inCause) if (then.has(l) && !missing.has(l) && then.get(l) !== now.get(l)) changed.push(l)
    otherChanged = (then.get('') ?? '') !== (now.get('') ?? '')
  }
  return { missing: [...missing].sort(), gone: gone.sort(), changed: changed.sort(), otherChanged }
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
    if (tag.kind === 'issue') return 2 + ISSUE_LETTERS.indexOf(tag.letter)
    return 100
  }
  return photos.map((p, i) => ({ p, i, r: rank(p) })).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.p)
}

/** Text split around "(A)" problem letters, for colouring them. */
export function splitIssueLetters(text: string): Array<{ letter: string | null; text: string }> {
  const out: Array<{ letter: string | null; text: string }> = []
  let last = 0
  for (const m of text.matchAll(/\(([A-Z])\)/g)) {
    if (m.index! > last) out.push({ letter: null, text: text.slice(last, m.index) })
    out.push({ letter: m[1], text: m[0] })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ letter: null, text: text.slice(last) })
  return out
}

// ── Page one (the roof overview and the problems at a glance) ──────────────

/**
 * Page one's problem list: "(A) Enclosed patio - Roof tiles stop short of the gutter", one per
 * line (the AI writes it, the inspector can edit it). A problem in the cause of damage without
 * a line of its own (none written yet, or added to the cause since) shows its first point there.
 */
export function problemSummaries(summaryText: string | null | undefined, cause: string | null | undefined): { letter: string; location: string; text: string }[] {
  const out = new Map<string, { letter: string; location: string; text: string }>()
  for (const line of (summaryText ?? '').split('\n')) {
    const body = line.trim().replace(/^[•\-*–]\s*/, '')
    const m = body.match(ISSUE_AT_START)
    if (!m || out.has(m[1])) continue
    const rest = body.slice(m[0].length).trim()
    const parts = rest.match(/^(.+?)\s+[-–—]\s+(.+)$/)
    out.set(m[1], parts ? { letter: m[1], location: parts[1].trim(), text: parts[2].trim() } : { letter: m[1], location: '', text: rest })
  }
  for (const p of issuePoints(cause)) if (!out.has(p.letter)) out.set(p.letter, { letter: p.letter, location: '', text: p.text })
  return [...out.values()].sort((a, b) => a.letter.localeCompare(b.letter))
}

/** A wide screenshot sits full width with the problems under it; anything squarer or taller sits beside them. */
export const isWideImage = (width: number, height: number): boolean => height > 0 && width / height > 1.35

/**
 * A short name for each problem, to remind the inspector what (A), (B)… are while tagging photos:
 * the location from page one's problem lines ("Rear roof"), or the first few words of the problem.
 */
export function problemNames(summaryText: string | null | undefined, cause: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of problemSummaries(summaryText, cause)) {
    const words = p.text.replace(/[.,;:]+$/, '').split(/\s+/)
    out[p.letter] = p.location || (words.length > 4 ? `${words.slice(0, 4).join(' ')}…` : words.join(' '))
  }
  return out
}
