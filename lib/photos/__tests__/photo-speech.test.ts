import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/images/downscale', () => ({ downscaleImage: async () => ({ data: Buffer.from(''), mimeType: 'image/jpeg' }) }))
vi.mock('../learning', () => ({ photoLearning: async () => ({ corrections: [], lessons: '' }) }))

const { speechByPhoto } = await import('../server-labels')
const { roofPhotoSystemPrompt } = await import('../ai-label')

// Roof photos taken with Bindi Co's camera while recording: what was said around each,
// from the draft's voice sections and photo times, for the photo sorting.

const T0 = Date.UTC(2026, 10, 14, 2, 0, 0)
const draft = {
  voiceSections: [{ id: 'v1', startedAt: T0, endedAt: T0 + 90_000, text: 'x', parts: [
    { start: 0, end: 5, text: 'Front of the house.' },
    { start: 60, end: 70, text: 'This is the failed valley on the rear roof.' },
  ] }],
  photoTimes: { p1: T0 + 3_000, p2: T0 + 65_000, p3: T0 + 30 * 60_000 },
}

describe('speechByPhoto', () => {
  it('gives each photo taken while talking what was said around it; none for the rest', () => {
    expect(speechByPhoto(draft)).toEqual({ p1: 'Front of the house.', p2: 'This is the failed valley on the rear roof.' })
  })
  it('is empty without voice notes', () => {
    expect(speechByPhoto({ photoTimes: draft.photoTimes })).toEqual({})
    expect(speechByPhoto({})).toEqual({})
  })
})

describe('roof photo sorting prompt', () => {
  it('uses the commentary to place a photo, with the problem list as the final word', () => {
    const p = roofPhotoSystemPrompt([{ letter: 'A', text: 'Failed valley' }])
    expect(p).toContain('was saying as they took it')
    expect(p).toContain('the problems list above is the final word')
  })
})
