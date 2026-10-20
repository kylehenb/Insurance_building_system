// Deterministic address parsing + comparison for email → job matching.
//
// Job addresses are stored free-form ("3 Redheart Way, Beeliar, WA 6164",
// "2 Laurina Way Beeliar 6164") and emails quote them inconsistently
// ("3 Redheart Way Beeliar", "13 Pepper Cl, Ballajura"). Substring ILIKE
// matching breaks on any of that, so both sides are parsed into
// { number, street, type, suburb } and compared field by field.

export type ParsedAddress = {
  /** Street number including any letter suffix, e.g. "21a". Unit numbers are dropped. */
  number: string | null
  /** Street name without its type, e.g. "redheart" or "oliver" */
  street: string
  /** Canonical street type, e.g. "st", "way" — null if the address had none */
  type: string | null
  /** Suburb words, lowercased, state/postcode removed — null if unknown */
  suburb: string | null
  /**
   * True when the suburb is reliable enough to rule a job OUT on mismatch.
   * Free-text captures without a comma ("13 Pepper Close for the vanity")
   * produce junk suburbs, so those are only used to confirm, never to reject.
   */
  suburbIsStrong: boolean
}

export type AddressMatch = 'exact' | 'street' | null

// Full word → canonical abbreviation. Abbreviations map to themselves.
const STREET_TYPES: Record<string, string> = {
  street: 'st', st: 'st',
  road: 'rd', rd: 'rd',
  drive: 'dr', dr: 'dr', drv: 'dr',
  avenue: 'ave', ave: 'ave', av: 'ave',
  close: 'cl', cl: 'cl',
  way: 'way', wy: 'way',
  place: 'pl', pl: 'pl',
  crescent: 'cres', cres: 'cres', cr: 'cres', crs: 'cres',
  court: 'ct', ct: 'ct', crt: 'ct',
  parade: 'pde', pde: 'pde',
  terrace: 'tce', tce: 'tce', terr: 'tce',
  boulevard: 'blvd', blvd: 'blvd', bvd: 'blvd',
  lane: 'ln', ln: 'ln',
  highway: 'hwy', hwy: 'hwy',
  circuit: 'cct', cct: 'cct',
  grove: 'gr', gr: 'gr', gve: 'gr',
  mews: 'mews',
  loop: 'loop',
  rise: 'rise',
  retreat: 'ret', ret: 'ret',
  vista: 'vista',
  heights: 'hts', hts: 'hts',
  gardens: 'gdns', gdns: 'gdns',
  square: 'sq', sq: 'sq',
  esplanade: 'esp', esp: 'esp',
  promenade: 'prom', prom: 'prom',
  pass: 'pass',
  link: 'link',
  entrance: 'ent', ent: 'ent',
  ramble: 'ramble',
  chase: 'chase',
  green: 'grn', grn: 'grn',
  walk: 'walk',
  view: 'view', vw: 'view',
  outlook: 'outlook',
  bend: 'bend',
  glade: 'glade',
  approach: 'app', app: 'app',
  cove: 'cove',
  quays: 'quays',
  ridge: 'rdg', rdg: 'rdg',
  turn: 'turn',
}

const STATES = new Set(['wa', 'nsw', 'vic', 'qld', 'sa', 'tas', 'act', 'nt'])

const TYPE_ALT = Object.keys(STREET_TYPES).sort((a, b) => b.length - a.length).join('|')

// <number>[/<number>] <1-4 street words> <type> <tail to end of line>
// The number group allows unit notation "2/15" — the street number is the last part.
const ADDRESS_RE = new RegExp(
  `\\b(\\d{1,5}[a-z]?(?:\\s*\\/\\s*\\d{1,5}[a-z]?)?)\\s+` +
  `([a-z][a-z']*(?:\\s+[a-z][a-z']*){0,3}?)\\s+` +
  `(${TYPE_ALT})\\b\\.?` +
  `([^\\n]{0,60})`,
  'gi'
)

function cleanWords(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function parseNumber(raw: string): string {
  const parts = raw.toLowerCase().replace(/\s+/g, '').split('/')
  return parts[parts.length - 1]
}

// Turns the text after the street type into a suburb, or null.
// Returns { suburb, strong } where strong = it was clearly delimited.
function parseTail(tail: string): { suburb: string | null; strong: boolean } {
  // Stop at obvious sentence/field breaks
  const cut = tail.split(/\s[-–|]\s|[;:()<>"]|\.\s/)[0]
  const startsWithComma = /^\s*,/.test(cut)
  const segments = cut.split(',').map(s => cleanWords(s)).filter(Boolean)

  for (const seg of segments) {
    const words = seg.split(' ').filter(w => !STATES.has(w) && !/^\d{4}$/.test(w))
    if (words.length === 0) continue
    // Postcode / state following the suburb is a strong delimiter even without commas
    const hasStateOrPostcode = seg.split(' ').some(w => STATES.has(w) || /^\d{4}$/.test(w))
    // Suburbs are 1-3 words; anything longer is prose
    if (words.length > 3) return { suburb: null, strong: false }
    if (words.some(w => /\d/.test(w))) return { suburb: null, strong: false }
    return { suburb: words.join(' '), strong: startsWithComma || hasStateOrPostcode }
  }
  return { suburb: null, strong: false }
}

/**
 * Parses a single address string (e.g. a job's property_address, or an
 * address Gemini extracted). Returns null when no "<number> <street> <type>"
 * shape is present — placeholder addresses like "Floreat" don't parse.
 */
export function parseAddress(input: string | null | undefined): ParsedAddress | null {
  if (!input) return null
  const found = findAddressesInText(input)
  if (found.length === 0) return null
  const first = found[0]
  // A standalone address string is structured data — trust its suburb
  return { ...first, suburbIsStrong: first.suburb !== null }
}

/** Finds every "<number> <street> <type> [, suburb]" occurrence in free text. */
export function findAddressesInText(text: string): ParsedAddress[] {
  const out: ParsedAddress[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(ADDRESS_RE)) {
    const street = cleanWords(m[2])
    if (!street) continue
    const type = STREET_TYPES[m[3].toLowerCase()] ?? null
    const { suburb, strong } = parseTail(m[4] ?? '')
    const addr: ParsedAddress = {
      number: parseNumber(m[1]),
      street,
      type,
      suburb,
      suburbIsStrong: strong,
    }
    const key = `${addr.number}|${addr.street}|${addr.type}|${addr.suburb}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(addr)
  }
  return out
}

function suburbsAgree(a: string, b: string): boolean {
  return a === b || a.includes(b) || b.includes(a)
}

/**
 * Compares an address found in an email against a job's parsed address.
 *   'exact'  — same number, street and type; suburb agrees or is unknown
 *   'street' — same street (and suburb if known) but number differs/missing
 *   null     — different street, or a reliable suburb that conflicts
 */
export function compareAddresses(email: ParsedAddress, job: ParsedAddress): AddressMatch {
  if (email.street !== job.street) return null
  if (email.type && job.type && email.type !== job.type) return null

  if (email.suburb && job.suburb && !suburbsAgree(email.suburb, job.suburb)) {
    // A weak suburb is free-text noise ("for the vanity") — ignore it.
    if (email.suburbIsStrong) return null
  }

  if (email.number && job.number && email.number === job.number) return 'exact'
  return 'street'
}
