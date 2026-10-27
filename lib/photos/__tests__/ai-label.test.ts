import { describe, it, expect, vi, beforeEach } from 'vitest'

// AI photo labels: Claude Haiku 5.5 looks at the photos (Gemini Flash if it
// fails or is chosen), each after its number; answers are matched back by that
// number. The text pass finishes the labels from the notes without images.

const create = vi.fn()
const generateContent = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create } } }))
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent } }, ThinkingLevel: { LOW: 'LOW' } }))

const { labelPhotos, relabelWithNotes, photoLabelSystemPrompt, PhotoLabelError, PHOTO_LABEL_MODEL } = await import('../ai-label')
const { GEMINI_FLASH_MODEL } = await import('@/lib/ai/gemini')

const photo = (data: string) => ({ data, mimeType: 'image/jpeg' })
const ctx = {
  notes: 'Kitchen ceiling stained from roof leak',
  scopeText: 'Kitchen: replace ceiling sheet',
  scopeRooms: ['Kitchen', 'Bed 2'],
  job: { lossType: 'Storm' },
}
const claudeReply = (photos: unknown[]) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ photos }) }] })

beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'test')
  vi.stubEnv('GEMINI_API_KEY', 'test')
  vi.stubEnv('PHOTO_LABEL_PROVIDER', '')
  create.mockReset()
  generateContent.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('labelPhotos', () => {
  it('sends every photo to Haiku 5.5 as an image, numbered, with structured output', async () => {
    create.mockResolvedValue(claudeReply([]))
    const res = await labelPhotos([photo('AAA'), photo('BBB')], ctx)
    expect(res.model).toBe(PHOTO_LABEL_MODEL)
    const req = create.mock.calls[0][0]
    expect(req.model).toBe('claude-haiku-5-5')
    expect(req.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } })
    const content = req.messages[0].content
    expect(content[0].text).toMatch(/Kitchen ceiling stained/)
    expect(content.slice(1)).toEqual([
      { type: 'text', text: 'Photo 1:' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAA' } },
      { type: 'text', text: 'Photo 2:' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBB' } },
    ])
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('matches answers back by photo number, not position', async () => {
    create.mockResolvedValue(claudeReply([
      { photo: 3, seen: 'sketch', kind: 'mud_map', confidence: 0.9, room: '', room_confidence: 0, label: 'Floor plan' },
      { photo: 1, seen: 'house front', kind: 'view_of_property', confidence: 0.8, room: 'External', room_confidence: 0.9, label: 'Front elevation - street' },
    ]))
    const { labels } = await labelPhotos([photo('a'), photo('b'), photo('c')], ctx)
    expect(labels[0]).toMatchObject({ kind: 'view_of_property', label: 'Front elevation - street', room: 'External', roomConfidence: 0.9, seen: 'house front' })
    expect(labels[1]).toBeNull()
    expect(labels[2]).toMatchObject({ kind: 'mud_map', label: 'Floor plan' })
  })

  it('falls back to Gemini when Claude fails or declines', async () => {
    create.mockResolvedValueOnce({ stop_reason: 'refusal', content: [] })
    generateContent.mockResolvedValueOnce({ text: JSON.stringify({ photos: [{ photo: 1, kind: 'other', confidence: 0.7, room: 'Kitchen', room_confidence: 0.8, seen: 'oven', label: 'Kitchen - oven' }] }) })
    const res = await labelPhotos([photo('a')], ctx)
    expect(res.model).toBe(GEMINI_FLASH_MODEL)
    expect(res.labels[0]).toMatchObject({ label: 'Kitchen - oven' })
    expect(generateContent.mock.calls[0][0].contents[2]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'a' } })
  })

  it('uses Gemini first when chosen', async () => {
    vi.stubEnv('PHOTO_LABEL_PROVIDER', 'gemini')
    generateContent.mockResolvedValue({ text: '{"photos":[]}' })
    await labelPhotos([photo('a')], ctx)
    expect(create).not.toHaveBeenCalled()
  })

  it('tidies odd answers and survives unreadable ones', async () => {
    create.mockResolvedValueOnce(claudeReply([{ photo: 1, kind: 'weird', confidence: 7, label: ' Lounge - carpet ' }]))
    expect((await labelPhotos([photo('a')], ctx)).labels[0]).toMatchObject({ kind: 'other', confidence: 1, label: 'Lounge - carpet' })
    create.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] })
    expect((await labelPhotos([photo('a')], ctx)).labels).toEqual([null])
  })

  it('says when it can’t label', async () => {
    create.mockRejectedValue(new Error('529'))
    generateContent.mockRejectedValue(new Error('503'))
    await expect(labelPhotos([photo('a')], ctx)).rejects.toBeInstanceOf(PhotoLabelError)
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('GEMINI_API_KEY', '')
    await expect(labelPhotos([photo('a')], ctx)).rejects.toThrow(/no AI key/)
  })
})

describe('photoLabelSystemPrompt', () => {
  it('weights the scope rooms but allows unaffected rooms', () => {
    const prompt = photoLabelSystemPrompt({ scopeRooms: ['Kitchen', 'Bed 2'] })
    expect(prompt).toMatch(/Rooms in the scope: Kitchen, Bed 2/)
    expect(prompt).toMatch(/no visible damage/)
    expect(photoLabelSystemPrompt({ scopeRooms: [] })).not.toMatch(/Rooms in the scope/)
  })

  it('includes the company’s past corrections and its own guidance', () => {
    const prompt = photoLabelSystemPrompt({
      scopeRooms: [], guidance: 'Always name the storey.',
      corrections: [{ seen: 'stained ceiling', aiLabel: 'Lounge - stain', finalLabel: 'Family Room - water-stained ceiling' }],
    })
    expect(prompt).toMatch(/Always name the storey\./)
    expect(prompt).toMatch(/"Lounge - stain" → inspector changed it to: "Family Room - water-stained ceiling"/)
  })
})

describe('relabelWithNotes', () => {
  it('finishes the AI’s labels from the notes, without images, and never touches the inspector’s', async () => {
    create.mockResolvedValue(claudeReply([
      { photo: 1, room: 'Kitchen', label: 'Kitchen - water-stained ceiling sheet' },
      { photo: 2, room: 'Bed 2', label: 'should be ignored' },
    ]))
    const res = await relabelWithNotes([
      { seen: 'stained ceiling', room: '', label: 'Internal - ceiling stain', locked: false },
      { seen: null, room: null, label: 'Bed 2 - my label', locked: true },
    ], ctx)
    expect(res).toEqual([{ room: 'Kitchen', label: 'Kitchen - water-stained ceiling sheet' }, null])
    const content = create.mock.calls[0][0].messages[0].content
    expect(content).toHaveLength(1)
    expect(content[0].text).toMatch(/Photo 2 \(inspector's label\): "Bed 2 - my label"/)
  })

  it('skips the call when every label is the inspector’s', async () => {
    expect(await relabelWithNotes([{ seen: null, room: null, label: 'x', locked: true }], ctx)).toEqual([null])
    expect(create).not.toHaveBeenCalled()
  })
})
