import { describe, it, expect } from 'vitest'
import { addVoiceNote, cleanPhotoTimes, cleanVoiceSections, speechAround, voiceNoteLine, type VoiceSection } from '../voice-timeline'

// Bindi Co voice notes: sections of talk with their timing, lined up with when photos were taken.

const T0 = new Date(2026, 10, 14, 10, 42, 0).getTime()
const section: VoiceSection = {
  id: 'v1', startedAt: T0, endedAt: T0 + 120_000, text: 'Front of the house. Rear roof now. Tiles short of the gutter at the patio.',
  parts: [
    { start: 0, end: 4, text: 'Front of the house.' },
    { start: 50, end: 54, text: 'Rear roof now.' },
    { start: 60, end: 66, text: 'Tiles short of the gutter at the patio.' },
  ],
}

describe('speechAround', () => {
  it('gives what was said from a little before to a little after the photo', () => {
    expect(speechAround(T0 + 2_000, [section])).toBe('Front of the house.')
    expect(speechAround(T0 + 63_000, [section])).toBe('Rear roof now. Tiles short of the gutter at the patio.')
  })
  it('is empty when nothing was being said', () => {
    expect(speechAround(T0 + 30 * 60_000, [section])).toBe('')
    expect(speechAround(T0, [])).toBe('')
  })
  it('falls back to the whole section when it has no phrase timings', () => {
    expect(speechAround(T0 + 10_000, [{ ...section, parts: [], endedAt: T0 + 20_000, text: 'Short one.' }])).toBe('Short one.')
  })
})

describe('saved draft', () => {
  it('keeps well-formed sections in time order and drops broken or repeated ones', () => {
    const later = { ...section, id: 'v2', startedAt: T0 + 600_000, endedAt: T0 + 660_000 }
    expect(cleanVoiceSections([later, section, { id: 'v1', startedAt: 1, endedAt: 2 }, { id: 'x' }, 'nope']).map(s => s.id)).toEqual(['v1', 'v2'])
    expect(cleanVoiceSections(null)).toEqual([])
  })
  it('keeps photo times that are numbers', () => {
    expect(cleanPhotoTimes({ p1: T0, p2: 'soon', '': 5 })).toEqual({ p1: T0 })
    expect(cleanPhotoTimes([1])).toEqual({})
  })
})

describe('adding a section to the notes', () => {
  it('starts it with its time, on its own paragraph', () => {
    expect(voiceNoteLine({ startedAt: T0, text: ' Tiles short. ' })).toBe('[10:42am] Tiles short.')
    expect(addVoiceNote('Met Mrs Smith.\n', { startedAt: T0, text: 'Tiles short.' })).toBe('Met Mrs Smith.\n\n[10:42am] Tiles short.')
    expect(addVoiceNote('', { startedAt: T0, text: 'Tiles short.' })).toBe('[10:42am] Tiles short.')
    expect(addVoiceNote('Notes', { startedAt: T0, text: '  ' })).toBe('Notes')
  })
})
