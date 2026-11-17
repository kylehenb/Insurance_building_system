import { describe, it, expect, vi, beforeAll } from 'vitest'

// The preview link: a valid token gets that tenant's document as an inline
// PDF; anything else gets nothing.

const calls: unknown[] = []
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/documents/preview', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/documents/preview')>()
  return { ...real, renderPreview: async (target: unknown, ctx: { tenantId: string }) => { calls.push([target, ctx.tenantId]); return { pdf: Buffer.from('%PDF-1.7'), filename: 'Q-IRC1080-1.pdf', title: 'Quote' } } }
})

const { GET } = await import('../route')
const { previewToken } = await import('@/lib/documents/preview')
const Q = '99999999-2222-3333-4444-555555555555'
const get = (token: string) => GET(new Request(`https://app.test/api/preview/${token}`) as never, { params: Promise.resolve({ token }) })

beforeAll(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key' })

describe('GET /api/preview/[token]', () => {
  it('serves the document inline for a valid link', async () => {
    const res = await get(previewToken('t1', { kind: 'quote', id: Q }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('inline; filename="Q-IRC1080-1.pdf"')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(calls).toEqual([[{ kind: 'quote', id: Q }, 't1']])
  })

  it('refuses an expired or forged link without rendering', async () => {
    calls.length = 0
    expect((await get(previewToken('t1', { kind: 'quote', id: Q }, Date.now() - 48 * 3_600_000))).status).toBe(404)
    expect((await get('forged.token')).status).toBe(404)
    expect(calls).toEqual([])
  })
})
