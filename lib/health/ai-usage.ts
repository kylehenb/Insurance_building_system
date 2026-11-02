import { healthDb, clip, errorMessage } from './db'
import { costUsd, type TokenCounts } from './pricing'

// Every AI request goes through trackAi (tech spec §25): it times the call,
// reads the token counts off the reply (whichever provider), prices it, and
// writes one ai_calls row — ok or failed. The weekly health check reads these
// for spend per week / feature / job and for AI failures. Recording never
// fails or changes the call: the reply (or the error) is passed straight on.
//
//   const reply = await trackAi({ feature: 'order-parser', provider: 'google', model, tenantId },
//     () => ai.models.generateContent({ ... }))

export type AiProvider = 'anthropic' | 'google' | 'openai'

export interface AiCallMeta {
  /** Short stable name of what the AI is doing, e.g. 'order-parser' */
  feature: string
  provider: AiProvider
  /** The model asked for; the model that answered is used when the reply says */
  model: string
  tenantId?: string | null
  jobId?: string | null
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Token counts from an Anthropic, Google (either SDK) or OpenAI reply. */
export function usageOf(reply: unknown): TokenCounts {
  const r = (reply ?? {}) as Record<string, unknown>
  // Anthropic: usage.input_tokens excludes cached tokens
  const usage = r.usage as Record<string, unknown> | undefined
  if (usage && ('input_tokens' in usage || 'output_tokens' in usage)) {
    return {
      input: num(usage.input_tokens),
      output: num(usage.output_tokens),
      cacheRead: num(usage.cache_read_input_tokens),
      cacheWrite: num(usage.cache_creation_input_tokens),
    }
  }
  // OpenAI: prompt_tokens (+ completion_tokens for chat; embeddings have none)
  if (usage && 'prompt_tokens' in usage) {
    return { input: num(usage.prompt_tokens), output: num(usage.completion_tokens), cacheRead: 0, cacheWrite: 0 }
  }
  // Google: @google/genai puts usageMetadata on the result, @google/generative-ai on result.response.
  // promptTokenCount includes cached tokens; thinking is billed as output.
  const meta = (r.usageMetadata ?? (r.response as Record<string, unknown> | undefined)?.usageMetadata) as Record<string, unknown> | undefined
  if (meta) {
    const cached = num(meta.cachedContentTokenCount)
    return {
      input: Math.max(0, num(meta.promptTokenCount) - cached),
      output: num(meta.candidatesTokenCount) + num(meta.thoughtsTokenCount),
      cacheRead: cached,
      cacheWrite: 0,
    }
  }
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
}

function servedModel(reply: unknown, asked: string): string {
  const r = (reply ?? {}) as Record<string, unknown>
  if (typeof r.model === 'string' && r.model) return r.model
  if (typeof r.modelVersion === 'string' && r.modelVersion) return r.modelVersion
  return asked
}

export interface AiCallRecord {
  meta: AiCallMeta
  model: string
  tokens: TokenCounts
  durationMs: number
  ok: boolean
  error?: string | null
}

export async function recordAiCall(rec: AiCallRecord): Promise<void> {
  try {
    const db = healthDb()
    if (!db) return
    const { error } = await db.from('ai_calls').insert({
      tenant_id: rec.meta.tenantId ?? null,
      job_id: rec.meta.jobId ?? null,
      feature: rec.meta.feature,
      provider: rec.meta.provider,
      model: rec.model,
      input_tokens: rec.tokens.input,
      output_tokens: rec.tokens.output,
      cache_read_tokens: rec.tokens.cacheRead,
      cache_write_tokens: rec.tokens.cacheWrite,
      cost_usd: costUsd(rec.model, rec.tokens),
      duration_ms: rec.durationMs,
      ok: rec.ok,
      error: clip(rec.error, 1000),
    })
    if (error) throw error
  } catch (err) {
    console.error(`[health] couldn't record AI call for ${rec.meta.feature}:`, err)
  }
}

export async function trackAi<T>(meta: AiCallMeta, call: () => Promise<T>): Promise<T> {
  const started = Date.now()
  let reply: T
  try {
    reply = await call()
  } catch (err) {
    await recordAiCall({
      meta, model: meta.model, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      durationMs: Date.now() - started, ok: false, error: errorMessage(err),
    })
    throw err
  }
  // A refusal or truncated answer still cost money, so it's recorded as ok;
  // a reply the caller can't read is logged by the caller (logError).
  await recordAiCall({ meta, model: servedModel(reply, meta.model), tokens: usageOf(reply), durationMs: Date.now() - started, ok: true })
  return reply
}
