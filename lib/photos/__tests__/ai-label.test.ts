import { describe, it, expect, vi, beforeEach } from 'vitest'

// AI photo labels: the photos themselves go to Gemini Flash, each after its
// number, and the answers are matched back by that number.

const generateContent = vi.fn()
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent } } }))

const { labelPhotos, photoLabelSystemPrompt, PhotoLabelError } = await import('../ai-label')
const { GEMINI_FLASH_MODEL } = await import('@/lib/ai/gemini')

const photo = (data: string) => ({ data, mimeType: 'image/jpeg' })
const opts = { notes: 'Kitchen ceiling stained from roof leak', job: { lossType: 'Storm' } }

beforeEach(() => {
  vi.stubEnv('GEMINI_API_KEY', 'test')
  generateContent.mockReset()
})

describe('labelPhotos', () => {
  it('sends every photo as an image, numbered, with the notes as context', async () => {
    generateContent.mockResolvedValue({ text: '[]' })
    await labelPhotos([photo('AAA'), photo('BBB')], opts)
    const req = generateContent.mock.calls[0][0]
    expect(req.model).toBe(GEMINI_FLASH_MODEL)
    expect(req.contents[0].text).toMatch(/Kitchen ceiling stained/)
    expect(req.contents.slice(1)).toEqual([
      { text: 'Photo 1:' }, { inlineData: { mimeType: 'image/jpeg', data: 'AAA' } },
      { text: 'Photo 2:' }, { inlineData: { mimeType: 'image/jpeg', data: 'BBB' } },
    ])
    expect(req.config.responseMimeType).toBe('application/json')
    expect(req.config.systemInstruction).toMatch(/look at each one/)
  })

  it('matches answers back by photo number, not position', async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify([
      { photo: 3, seen: 'sketch', kind: 'mud_map', confidence: 0.9, label: 'Floor plan' },
      { photo: 1, seen: 'house front', kind: 'view_of_property', confidence: 0.8, label: 'Front elevation - street' },
    ]) })
    const res = await labelPhotos([photo('a'), photo('b'), photo('c')], opts)
    expect(res).toEqual([
      { kind: 'view_of_property', confidence: 0.8, label: 'Front elevation - street' },
      null,
      { kind: 'mud_map', confidence: 0.9, label: 'Floor plan' },
    ])
  })

  it('tidies odd answers and survives unreadable ones', async () => {
    generateContent.mockResolvedValueOnce({ text: JSON.stringify([{ photo: 1, kind: 'weird', confidence: 7, label: ' Lounge - carpet ' }]) })
    expect(await labelPhotos([photo('a')], opts)).toEqual([{ kind: 'other', confidence: 1, label: 'Lounge - carpet' }])
    vi.spyOn(console, 'error').mockImplementation(() => {})
    generateContent.mockResolvedValueOnce({ text: 'not json' })
    expect(await labelPhotos([photo('a')], opts)).toEqual([null])
  })

  it('says when it can’t label', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    generateContent.mockRejectedValueOnce(new Error('503'))
    await expect(labelPhotos([photo('a')], opts)).rejects.toBeInstanceOf(PhotoLabelError)
    vi.stubEnv('GEMINI_API_KEY', '')
    await expect(labelPhotos([photo('a')], opts)).rejects.toThrow(/GEMINI_API_KEY/)
  })

  it('uses the tenant’s photo labelling prompt as guidance', () => {
    expect(photoLabelSystemPrompt('Always name the storey.')).toMatch(/Always name the storey\./)
    expect(photoLabelSystemPrompt('')).toMatch(/building element/)
  })
})
