// Picking a job's photos and files the way people say them: "photo 2",
// "photos 45-47", "2, 5 and 7", a label ("floor plan"), a file name, or the
// photo_id / file_id from list_job_files. Photo numbers are positions in the
// job's photo list (listJobAttachables order), as list_job_files numbers
// them. Pure — safe for client code.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** "photos 45-47", "45 to 47", "2, 5 and 7", "#3" */
const NUMBERS_RE = /^(?:(?:photos?|pics?|pictures?|images?|nos?\.?|numbers?)\s*)?#?\s*\d+(?:\s*(?:-|–|—|to|through|thru|,|and|&|#)\s*#?\s*\d+)*$/i
/** Most photos one range may expand to */
const MAX_RANGE = 100

export interface RefPhoto { id: string; label: string | null; name: string }
export interface RefFile { id: string; name: string; description?: string | null }

export interface Resolved<T> {
  /** Matches in the order asked, without repeats */
  items: T[]
  /** References that matched nothing */
  unmatched: string[]
}

/** The 1-based numbers in a "45-47" / "2, 5 and 7" reference, or null if it isn't one. */
export function parseNumbers(ref: string): number[] | null {
  const text = ref.trim()
  if (!NUMBERS_RE.test(text)) return null
  const body = text.replace(/^[^\d#]*/, '')
  const out: number[] = []
  for (const part of body.split(/\s*(?:,|and|&)\s*/i)) {
    const range = part.match(/^#?\s*(\d+)\s*(?:-|–|—|to|through|thru)\s*#?\s*(\d+)$/i)
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])]
      const [lo, hi] = a <= b ? [a, b] : [b, a]
      if (hi - lo >= MAX_RANGE) return null
      for (let n = lo; n <= hi; n++) out.push(n)
      continue
    }
    const single = part.match(/^#?\s*(\d+)$/)
    if (!single) return null
    out.push(Number(single[1]))
  }
  return out
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const stripExt = (s: string) => s.replace(/\.[a-z0-9]{2,5}$/i, '')

function addUnique<T extends { id: string }>(list: T[], add: T[]) {
  for (const x of add) if (!list.some(y => y.id === x.id)) list.push(x)
}

/**
 * The photos meant by refs. A label or name matches exactly first, else
 * every photo whose label or name contains it (so "roof" can mean several).
 */
export function resolvePhotoRefs<T extends RefPhoto>(photos: T[], refs: string[]): Resolved<T> {
  const items: T[] = []
  const unmatched: string[] = []
  for (const raw of refs) {
    const ref = raw.trim()
    if (!ref) continue
    if (/^all(?: (?:the )?photos?)?$/i.test(ref)) { if (photos.length) addUnique(items, photos); else unmatched.push(ref); continue }
    if (UUID_RE.test(ref)) {
      const hit = photos.find(p => p.id.toLowerCase() === ref.toLowerCase())
      if (hit) addUnique(items, [hit]); else unmatched.push(ref)
      continue
    }
    const numbers = parseNumbers(ref)
    if (numbers) {
      const missing = numbers.filter(n => n < 1 || n > photos.length)
      if (missing.length) unmatched.push(ref)
      else addUnique(items, numbers.map(n => photos[n - 1]))
      continue
    }
    const want = norm(ref.replace(/^(?:the\s+)?(?:(?:photos?|pictures?|pics?)\s+(?:of\s+)?(?:the\s+)?)?/i, ''))
    const exact = photos.filter(p => norm(p.label) === want || norm(stripExt(p.name)) === want || norm(p.name) === want)
    const partial = exact.length ? exact : photos.filter(p => norm(p.label).includes(want) || norm(p.name).includes(want))
    if (want && partial.length) addUnique(items, partial); else unmatched.push(ref)
  }
  return { items, unmatched }
}

/** The files meant by refs: file_id, exact name (with or without extension), else a name or description containing it. */
export function resolveFileRefs<T extends RefFile>(files: T[], refs: string[]): Resolved<T> {
  const items: T[] = []
  const unmatched: string[] = []
  for (const raw of refs) {
    const ref = raw.trim()
    if (!ref) continue
    if (UUID_RE.test(ref)) {
      const hit = files.find(f => f.id.toLowerCase() === ref.toLowerCase())
      if (hit) addUnique(items, [hit]); else unmatched.push(ref)
      continue
    }
    const want = norm(ref)
    const exact = files.filter(f => norm(f.name) === want || norm(stripExt(f.name)) === want)
    const partial = exact.length ? exact : files.filter(f => norm(f.name).includes(want) || norm(f.description).includes(want))
    if (partial.length) addUnique(items, partial); else unmatched.push(ref)
  }
  return { items, unmatched }
}
