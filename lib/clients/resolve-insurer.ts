import type { SupabaseClient } from '@supabase/supabase-js'

export interface InsurerClientCandidate {
  id: string
  name: string
  trading_name: string | null
}

export interface InsurerSignals {
  /** Insurer name as extracted by the parser (may be loosely worded, e.g. "CASTLE INSURANCE PTY LTD"). */
  insurer?: string | null
  fromEmail?: string | null
  fromName?: string | null
  subject?: string | null
  body?: string | null
}

// Generic words that appear in insurer names but don't identify the insurer.
const NOISE_WORDS = new Set([
  'insurance', 'insurer', 'insurers', 'underwriting', 'underwriters', 'group',
  'australia', 'australian', 'pty', 'ltd', 'limited', 'co', 'company', 'the',
  'services', 'claims', 'general', 'agency', 'inc',
])

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Core identifying words of a name, e.g. "Castle Insurance Pty Ltd" → "castle". */
function coreName(name: string): string {
  const full = normalise(name)
  const core = full.split(' ').filter(w => w && !NOISE_WORDS.has(w)).join(' ')
  return core || full
}

function containsPhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return false
  return ` ${haystack} `.includes(` ${phrase} `)
}

function countPhrase(haystack: string, phrase: string): number {
  if (!phrase) return 0
  return ` ${haystack} `.split(` ${phrase} `).length - 1
}

function clientCores(client: InsurerClientCandidate): string[] {
  return [client.name, client.trading_name]
    .filter((n): n is string => Boolean(n && n.trim()))
    .map(coreName)
}

/**
 * Picks the insurer client that best matches the parsed insurer name, falling
 * back to the email sender, subject and body. Returns null when nothing matches.
 */
export function matchInsurerClient(
  clients: InsurerClientCandidate[],
  signals: InsurerSignals
): InsurerClientCandidate | null {
  if (clients.length === 0) return null

  // 1. Parsed insurer name: exact core match, then whole-word containment either way.
  if (signals.insurer && signals.insurer.trim()) {
    const parsedCore = coreName(signals.insurer)
    const parsedFull = normalise(signals.insurer)

    const exact = clients.find(c => clientCores(c).includes(parsedCore))
    if (exact) return exact

    let best: { client: InsurerClientCandidate; len: number } | null = null
    for (const client of clients) {
      for (const core of clientCores(client)) {
        if (containsPhrase(parsedFull, core) || containsPhrase(core, parsedCore)) {
          if (!best || core.length > best.len) best = { client, len: core.length }
        }
      }
    }
    if (best) return best.client
  }

  // 2. Sender address — words run together there (e.g. castleinsurance.mailer@...),
  //    so match on the core name with spaces removed. Longest match wins.
  if (signals.fromEmail) {
    const compactEmail = signals.fromEmail.toLowerCase().replace(/[^a-z0-9]/g, '')
    let best: { client: InsurerClientCandidate; len: number } | null = null
    for (const client of clients) {
      for (const core of clientCores(client)) {
        const compactCore = core.replace(/ /g, '')
        if (compactCore.length >= 3 && compactEmail.includes(compactCore)) {
          if (!best || compactCore.length > best.len) best = { client, len: compactCore.length }
        }
      }
    }
    if (best) return best.client
  }

  // 3. Sender name, then subject, then body — first source with a hit wins,
  //    and within a source the most frequently mentioned insurer wins.
  const sources = [signals.fromName ?? '', signals.subject ?? '', signals.body ?? '']
  for (const source of sources) {
    const text = normalise(source)
    if (!text) continue
    let best: { client: InsurerClientCandidate; count: number } | null = null
    for (const client of clients) {
      const count = Math.max(0, ...clientCores(client).map(core => countPhrase(text, core)))
      if (count > 0 && (!best || count > best.count)) best = { client, count }
    }
    if (best) return best.client
  }

  return null
}

/** Loads the tenant's active insurer clients and resolves the best match. */
export async function resolveInsurerClient(
  supabase: SupabaseClient,
  tenantId: string,
  signals: InsurerSignals
): Promise<InsurerClientCandidate | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, trading_name')
    .eq('tenant_id', tenantId)
    .eq('client_type', 'insurer')
    .eq('status', 'active')

  if (error) {
    console.error('[resolve-insurer] clients fetch error:', error)
    return null
  }
  return matchInsurerClient((data ?? []) as InsurerClientCandidate[], signals)
}
