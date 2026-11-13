// Bindi Co's voice notes (the field app's Record button): each stretch of talking
// between Record and Pause is one section, turned into text with its timing
// (lib/audio/transcribe.ts). Sections and the times photos were taken with the
// app's camera are kept in the field draft, so what was said around each photo
// can be put beside it when the AI sorts the photos (lib/photos/server-labels.ts).
// All times are the phone's clock, in milliseconds. Safe to import in the browser.

/** A phrase in a section, seconds from the section's start */
export interface VoicePart { start: number; end: number; text: string }

export interface VoiceSection {
  /** The phone's id for the section */
  id: string
  startedAt: number
  endedAt: number
  text: string
  parts: VoicePart[]
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Sections from a saved draft: well-formed ones only, in time order */
export function cleanVoiceSections(value: unknown): VoiceSection[] {
  if (!Array.isArray(value)) return []
  const out: VoiceSection[] = []
  const ids = new Set<string>()
  for (const raw of value) {
    const s = (raw ?? {}) as Record<string, unknown>
    const id = typeof s.id === 'string' ? s.id : ''
    const startedAt = num(s.startedAt), endedAt = num(s.endedAt)
    if (!id || ids.has(id) || startedAt === null || endedAt === null) continue
    const parts = (Array.isArray(s.parts) ? s.parts : []).flatMap(p => {
      const q = (p ?? {}) as Record<string, unknown>
      const start = num(q.start), end = num(q.end)
      return start === null || end === null || typeof q.text !== 'string' ? [] : [{ start, end, text: q.text.trim() }]
    })
    ids.add(id)
    out.push({ id, startedAt, endedAt, text: typeof s.text === 'string' ? s.text.trim() : '', parts })
  }
  return out.sort((a, b) => a.startedAt - b.startedAt)
}

/** When each photo was taken with the app's camera, by the photo's client id */
export function cleanPhotoTimes(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const t = num(v)
    if (k && t !== null) out[k] = t
  }
  return out
}

/** Seconds of talk looked at before and after a photo was taken */
export const SPEECH_BEFORE_S = 25
export const SPEECH_AFTER_S = 10

/**
 * What was said around the moment a photo was taken: the phrases from a little
 * before to a little after it, in order. Empty when nothing was being recorded.
 */
export function speechAround(takenAt: number, sections: VoiceSection[], beforeS = SPEECH_BEFORE_S, afterS = SPEECH_AFTER_S): string {
  const from = takenAt - beforeS * 1000, to = takenAt + afterS * 1000
  const said: string[] = []
  for (const s of sections) {
    if (s.endedAt < from || s.startedAt > to) continue
    const parts = s.parts.length ? s.parts : [{ start: 0, end: (s.endedAt - s.startedAt) / 1000, text: s.text }]
    for (const p of parts) {
      const a = s.startedAt + p.start * 1000, b = s.startedAt + p.end * 1000
      if (b >= from && a <= to && p.text) said.push(p.text)
    }
  }
  return said.join(' ').replace(/\s+/g, ' ').trim().slice(0, 600)
}

/** A section as it's added to the job notes: its time, then what was said */
export function voiceNoteLine(section: Pick<VoiceSection, 'startedAt' | 'text'>): string {
  const d = new Date(section.startedAt)
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0')
  return `[${h % 12 || 12}:${m}${h < 12 ? 'am' : 'pm'}] ${section.text.trim()}`
}

/** The notes with a section added at the end, on its own paragraph */
export function addVoiceNote(notes: string, section: Pick<VoiceSection, 'startedAt' | 'text'>): string {
  if (!section.text.trim()) return notes
  const line = voiceNoteLine(section)
  return notes.trim() ? `${notes.replace(/\s+$/, '')}\n\n${line}` : line
}
