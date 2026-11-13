import OpenAI, { toFile } from 'openai'
import { trackAi } from '@/lib/health/ai-usage'
import type { VoicePart } from './voice-timeline'

// Speech to text for Bindi Co's voice notes, on OpenAI's whisper-1: the one
// speech model that returns when each phrase was said, which is what lines
// photos up with what was being said (lib/audio/voice-timeline.ts). Given the
// trade words to expect, so "sarking" doesn't come back as "parking".

export const TRANSCRIBE_MODEL = 'whisper-1'

/** Words a roof inspection uses that speech models get wrong without a hint (the prompt is ~200 tokens at most) */
export const ROOF_VOCABULARY = [
  'Colorbond', 'Zincalume', 'terracotta tiles', 'concrete tiles', 'ridge capping', 'pointing', 'bedding',
  'valley iron', 'box gutter', 'quad gutter', 'fascia', 'soffit', 'eaves', 'downpipe', 'rainhead', 'sump',
  'sarking', 'Anticon', 'air-cell', 'battens', 'trusses', 'rafters', 'flashing', 'apron flashing', 'barge',
  'parapet', 'penetrations', 'skylight', 'whirlybird', 'solar PV', 'HWS', 'pitch', 'storeys', 'make safe',
]

export class TranscribeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TranscribeError'
  }
}

let client: OpenAI | null = null
function openai(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new TranscribeError('OPENAI_API_KEY is not set')
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 90_000, maxRetries: 1 })
  return client
}

/** A recording turned into text, with each phrase's time from the start, and how long it ran */
export async function transcribeAudio(audio: { data: Buffer; name: string; type: string }, meta: { feature: string; tenantId: string; jobId?: string | null }): Promise<{ text: string; parts: VoicePart[]; seconds: number }> {
  const api = openai()
  const file = await toFile(audio.data, audio.name, { type: audio.type })
  const track = { feature: meta.feature, provider: 'openai' as const, model: TRANSCRIBE_MODEL, tenantId: meta.tenantId, jobId: meta.jobId ?? null }
  const reply = await trackAi(track, () => api.audio.transcriptions.create({
    file,
    model: TRANSCRIBE_MODEL,
    language: 'en',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
    prompt: `Australian roof inspection notes, spoken on site. ${ROOF_VOCABULARY.join(', ')}.`,
  }))
  const parts = (reply.segments ?? [])
    .map(s => ({ start: s.start, end: s.end, text: s.text.trim() }))
    .filter(p => p.text)
  return { text: (reply.text ?? '').trim(), parts, seconds: reply.duration ?? 0 }
}
