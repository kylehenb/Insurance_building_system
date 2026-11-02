// What each AI model costs, in US dollars per million tokens (tech spec §25).
// Used to put a dollar figure on every row of ai_calls. A model missing here
// is still recorded (tokens, ok/failed) with cost_usd null, and the health
// check lists it as "no price set" — add it here when a new model is used.
//
// Prices last checked 2 Nov 2026. Override or add without a deploy by setting
// AI_PRICES to JSON, e.g. {"gemini-3.5-flash":{"input":1.5,"output":9}}.

export interface ModelPrice {
  input: number
  output: number
  /** Cached input read; defaults to 10% of input */
  cacheRead?: number
  /** Cache write; defaults to 125% of input */
  cacheWrite?: number
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Anthropic
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  // Google
  'gemini-3.5-flash': { input: 1.5, output: 9, cacheRead: 0.15 },
  // OpenAI (embeddings have no output tokens)
  'text-embedding-3-small': { input: 0.02, output: 0 },
}

export interface TokenCounts {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

function priceTable(): Record<string, ModelPrice> {
  const raw = process.env.AI_PRICES
  if (!raw) return MODEL_PRICES
  try {
    return { ...MODEL_PRICES, ...(JSON.parse(raw) as Record<string, ModelPrice>) }
  } catch {
    console.error('[health] AI_PRICES is not valid JSON — using the built-in prices')
    return MODEL_PRICES
  }
}

/** The price for a model id, tolerating provider prefixes and dated suffixes. */
export function priceFor(model: string): ModelPrice | null {
  const table = priceTable()
  const id = model.replace(/^models\//, '').replace(/^anthropic\./, '')
  if (table[id]) return table[id]
  // Longest known id the served name starts with (e.g. 'gemini-3.5-flash-001')
  const match = Object.keys(table).filter(k => id.startsWith(k)).sort((a, b) => b.length - a.length)[0]
  return match ? table[match] : null
}

/** Dollar cost of one call, or null when the model has no price. */
export function costUsd(model: string, t: TokenCounts): number | null {
  const p = priceFor(model)
  if (!p) return null
  const cacheRead = p.cacheRead ?? p.input * 0.1
  const cacheWrite = p.cacheWrite ?? p.input * 1.25
  const dollars = (t.input * p.input + t.output * p.output + t.cacheRead * cacheRead + t.cacheWrite * cacheWrite) / 1_000_000
  return Math.round(dollars * 1_000_000) / 1_000_000
}
