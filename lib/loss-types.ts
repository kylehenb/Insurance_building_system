// The fixed list of claim (loss) types. jobs.loss_type, reports.loss_type and
// insurer_orders.loss_type only ever hold one of these values (or null) — enforced by
// CHECK constraints in supabase/migrations/20261010_loss_type_list.sql. To change the
// list, update it here and in that constraint.

export const LOSS_TYPES = [
  'Accidental Loss or Damage',
  'Age, Wear and Tear',
  'Animal',
  'Burglary',
  'Cracking',
  'Earthquake',
  'Electric Motor Fusion',
  'Escape of Liquids',
  'Explosion',
  'Fire or Smoke',
  'Flood',
  'Glass Breakage',
  'Home Warranty Defects',
  'Home Warranty Uncompleted Works',
  'Impact by Animals',
  'Impact by Falling Trees',
  'Impact or Collision by Vehicle',
  'Impact or Collision by Watercraft',
  'Lightning or Thunderbolt',
  'Maintenance',
  'Malicious Act or Vandalism',
  'Mould',
  'Other',
  'Pets or Vermin',
  'Rectification',
  'Riot, Civil Commotion or Public Disturbance',
  'Storm or Rainwater',
  'Theft and / or Damage by Thieves',
  'Tsunami',
] as const

export type LossType = (typeof LOSS_TYPES)[number]

function key(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

const BY_KEY = new Map<string, LossType>(LOSS_TYPES.map(t => [key(t), t]))

// Common wordings from insurer emails and older free-text entries. A value matches an
// alias exactly or by starting with it (e.g. "Storm - water ingress via roof" → storm).
const ALIASES: [string, LossType][] = [
  ['storm', 'Storm or Rainwater'],
  ['rain', 'Storm or Rainwater'],
  ['rainwater', 'Storm or Rainwater'],
  ['wind', 'Storm or Rainwater'],
  ['hail', 'Storm or Rainwater'],
  ['cyclone', 'Storm or Rainwater'],
  ['escape of liquid', 'Escape of Liquids'],
  ['escape of water', 'Escape of Liquids'],
  ['burst pipe', 'Escape of Liquids'],
  ['water damage', 'Escape of Liquids'],
  ['fire', 'Fire or Smoke'],
  ['smoke', 'Fire or Smoke'],
  ['lightning', 'Lightning or Thunderbolt'],
  ['theft', 'Theft and / or Damage by Thieves'],
  ['damage by thieves', 'Theft and / or Damage by Thieves'],
  ['damage by theives', 'Theft and / or Damage by Thieves'],
  ['vandalism', 'Malicious Act or Vandalism'],
  ['malicious damage', 'Malicious Act or Vandalism'],
  ['impact by vehicle', 'Impact or Collision by Vehicle'],
  ['vehicle impact', 'Impact or Collision by Vehicle'],
  ['accidental damage', 'Accidental Loss or Damage'],
  ['wear and tear', 'Age, Wear and Tear'],
  ['vermin', 'Pets or Vermin'],
  ['termites', 'Pets or Vermin'],
  ['glass', 'Glass Breakage'],
  ['motor burnout', 'Electric Motor Fusion'],
]

export function isLossType(value: unknown): value is LossType {
  return typeof value === 'string' && (LOSS_TYPES as readonly string[]).includes(value)
}

/** Map any loss type wording onto the fixed list. Returns null when it can't be matched. */
export function normaliseLossType(value: unknown): LossType | null {
  if (typeof value !== 'string') return null
  const k = key(value)
  if (!k) return null
  const exact = BY_KEY.get(k)
  if (exact) return exact
  // A tree coming down is its own category even when the wording leads with "storm"
  if (k.includes('falling tree') || k.includes('fallen tree')) return 'Impact by Falling Trees'
  for (const [alias, type] of ALIASES) {
    if (k === alias || k.startsWith(`${alias} `)) return type
  }
  return null
}

/** The list as a single line, for AI prompts that must pick one value. */
export const LOSS_TYPES_PROMPT_LIST = LOSS_TYPES.map(t => `"${t}"`).join(', ')
