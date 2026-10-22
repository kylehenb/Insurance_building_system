import { describe, it, expect, vi, beforeEach } from 'vitest'

// When Gemini can't be reached (e.g. a retired model), the order parser must
// fail loudly. It used to return is_new_order=false, so every order email was
// silently dropped from 19 Oct 2026 when gemini-2.5-flash was shut down.

const generateContent = vi.fn()
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent } } }))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({ from: () => {
    const b: Record<string, unknown> = { select: () => b, eq: () => b, order: () => b, limit: () => b, single: async () => ({ data: null, error: null }) }
    return b
  } }),
}))

const { parseInsurerOrder } = await import('../order-parser')
const { GEMINI_FLASH_MODEL } = await import('@/lib/ai/gemini')

const message = {
  messageId: 'm1', threadId: 't1', subject: 'New Quote/Report Request CHCCLM010002035', from: 'Castle <c@castle.example>',
  fromEmail: 'c@castle.example', fromName: 'Castle', to: 'office@example.com', bodyText: 'Please inspect…',
  receivedAt: '2026-10-22T05:56:00Z', gmailMessageId: 'm1', attachments: [],
} as never

beforeEach(() => {
  vi.stubEnv('GEMINI_API_KEY', 'test')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  generateContent.mockReset()
})

describe('order parser', () => {
  it('throws when Gemini fails, instead of calling the email "not an order"', async () => {
    generateContent.mockRejectedValue(new Error('404 models/gemini-2.5-flash is not found'))
    await expect(parseInsurerOrder(message)).rejects.toThrow(/Gemini could not classify the email: 404/)
  })

  it('classifies with the shared current model', async () => {
    generateContent.mockResolvedValue({ text: '{"is_new_order": true, "is_new_order_reasoning": "New request", "claim_number": "CHCCLM010002035", "confidence": 0.9}' })
    const parsed = await parseInsurerOrder(message)
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({ model: GEMINI_FLASH_MODEL }))
    expect(GEMINI_FLASH_MODEL).not.toBe('gemini-2.5-flash')
    expect(parsed.isNewOrder).toBe(true)
  })
})
