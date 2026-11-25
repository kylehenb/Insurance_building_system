import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

// preview_document: a link to the PDF as it would be sent, and its pages for
// Claude when asked to look. Never sends or marks anything sent.

const WO = '11111111-2222-3333-4444-555555555555'
const Q = '99999999-2222-3333-4444-555555555555'
const rendered: string[] = []

vi.mock('@/lib/documents/send/documents', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/documents/send/documents')>()
  return {
    ...real,
    prepareDocument: async (ref: { kind: string; id: string }) => {
      if (ref.id !== Q) throw new real.DocumentSendError('Quote not found', 404)
      return { title: 'Quote Q-IRC1080-1', filename: 'Q-IRC1080-1.pdf', warnings: ['The quote is still a draft.'], render: async () => { rendered.push(ref.id); return Buffer.from('%PDF') } }
    },
  }
})
vi.mock('@/lib/work-orders/work-order-pdf', () => ({
  WorkOrderPdfError: class extends Error { status = 404 },
  buildWorkOrderPdf: async (id: string) => { rendered.push(id); return { pdf: Buffer.from('%PDF'), filename: 'WO.pdf' } },
}))
vi.mock('@/lib/mcp/tools/work-orders', () => ({
  summariseWorkOrder: async (id: string) => (id === WO ? { job_number: 'IRC1080', trade: 'Plumber', business_name: 'True Fix', sent: false } : null),
}))
vi.mock('@/lib/pdf/render-pdf-pages', () => ({
  renderPdfPages: async () => [1, 2, 3, 4].map(() => ({ image: Buffer.from('img'), widthPt: 595, heightPt: 842, contentType: 'image/jpeg' })),
}))
vi.mock('@/lib/images/downscale', () => ({ downscaleImage: async () => ({ data: Buffer.from('small'), mimeType: 'image/jpeg' }) }))

const { previewDocument } = await import('../tools/preview')
const { readPreviewToken } = await import('@/lib/documents/preview')
const ctx = { supabase: {} as never, tenantId: 't1', userId: 'u1' } as never
const tokenOf = (link: string) => link.split('/api/preview/')[1]

beforeAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
})
beforeEach(() => { rendered.length = 0 })

describe('preview_document', () => {
  it('links to a work order without rendering it', async () => {
    const res = await previewDocument.run({ work_order_id: WO }, ctx)
    expect(res.text).toMatch(/^Here's the Plumber \(True Fix\) work order on IRC1080 \(draft — not sent yet\) to look at: https:\/\/app\.test\/api\/preview\//)
    expect(res.text).toContain('Nothing has been sent or marked sent.')
    expect(readPreviewToken(tokenOf(res.data!.link as string))).toEqual({ tenantId: 't1', target: { kind: 'work_order', id: WO } })
    expect(rendered).toEqual([])
    expect(res.images).toBeUndefined()
  })

  it('passes on the document warnings, and shows Claude the first pages when asked to look', async () => {
    const res = await previewDocument.run({ document: { kind: 'quote', id: Q }, look: true }, ctx)
    expect(res.text).toContain("Here's Quote Q-IRC1080-1 to look at:")
    expect(res.text).toContain('Showing you pages 1–3 of 4.')
    expect(res.text).toContain('Worth a look before sending: The quote is still a draft.')
    expect(res.images).toHaveLength(3)
    expect(rendered).toEqual([Q])
  })

  it('links to a scope of works covering several quotes, keeping the quotes in the link', async () => {
    const Q2 = '88888888-2222-3333-4444-555555555555'
    const res = await previewDocument.run({ document: { kind: 'scope', id: Q, quoteIds: [Q2] } }, ctx)
    expect(res.isError).toBeFalsy()
    expect(readPreviewToken(tokenOf(res.data!.link as string))).toEqual({ tenantId: 't1', target: { kind: 'scope', id: Q, quoteIds: [Q2] } })
    expect(rendered).toEqual([])
  })

  it('says so for a missing document or no document', async () => {
    expect(await previewDocument.run({ work_order_id: '22222222-2222-3333-4444-555555555555' }, ctx)).toMatchObject({ isError: true, text: expect.stringContaining('Work order not found') })
    expect(await previewDocument.run({ document: { kind: 'quote', id: WO } }, ctx)).toMatchObject({ isError: true, text: 'Quote not found' })
    expect((await previewDocument.run({}, ctx)).isError).toBe(true)
  })
})
