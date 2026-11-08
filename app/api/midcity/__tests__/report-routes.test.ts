import { describe, it, expect, vi, beforeEach } from 'vitest'

// The Midcity report routes run AI on the company's bill: they need a signed-in
// user, and record the AI use against that user's company.

let me: { tenantId: string; userId: string } | null = null
const tracked: Array<Record<string, unknown>> = []
const aiCalls: Array<{ system?: string }> = []
let aiReply = '{"roofType":"Colorbond"}'

vi.mock('@/lib/auth/session', () => ({ sessionUser: async () => me, unauthorized: () => new Response('{}', { status: 401 }) }))
vi.mock('@/lib/health/ai-usage', () => ({
  trackAi: async (meta: Record<string, unknown>, call: () => Promise<unknown>) => { tracked.push(meta); return call() },
}))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async (args: { system?: string }) => {
        aiCalls.push(args)
        return { content: [{ type: 'text', text: aiReply }] }
      },
    }
  },
}))

const roof = await import('../generate-roof-report/route')
const insurance = await import('../generate-insurance-report/route')
const post = (route: { POST: (req: never) => Promise<Response> }, body: unknown) =>
  route.POST(new Request('https://app.test/api/midcity/x', { method: 'POST', body: JSON.stringify(body) }) as never)

beforeEach(() => {
  me = null
  tracked.length = 0
  aiCalls.length = 0
  aiReply = '{"roofType":"Colorbond"}'
})

describe('Midcity report routes', () => {
  it('refuse without a signed-in user, before any AI call', async () => {
    expect((await post(roof, { rawNotes: 'Tiles cracked' })).status).toBe(401)
    expect((await post(insurance, { rawNotes: 'Tiles cracked', template: 'aai' })).status).toBe(401)
    expect(aiCalls).toHaveLength(0)
  })

  it('records the roof report AI use against the signed-in company', async () => {
    me = { tenantId: 't1', userId: 'u1' }
    const res = await post(roof, { rawNotes: 'Colorbond roof, cracked flashing' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, reportData: { roofType: 'Colorbond' } })
    expect(tracked).toEqual([expect.objectContaining({ feature: 'midcity-roof-report', tenantId: 't1' })])
  })

  it('asks for the cause of damage as dot points, and tidies what comes back into "• " points', async () => {
    me = { tenantId: 't1', userId: 'u1' }
    aiReply = JSON.stringify({ specificCause: 'Stormwater entry at the patio: (1) tiles short of the gutter; (2) 17 broken tiles' })
    const res = await post(roof, { rawNotes: 'Patio leak' })
    expect((await res.json()).reportData.specificCause).toBe('Stormwater entry at the patio:\n• Tiles short of the gutter\n• 17 broken tiles')
    expect(aiCalls[0].system).toContain('CAUSE OF DAMAGE FORMAT')
  })
})
