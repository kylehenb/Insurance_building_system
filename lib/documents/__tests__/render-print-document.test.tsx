import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fx from '@/lib/__tests__/print-documents.fixture'

// The page is printed by Chromium elsewhere; here: the HTML it is given.

const evaluate = vi.fn(async (_fn: unknown, src: string) => `${src}#shrunk`)
vi.mock('@/lib/pdf/render-html-to-pdf', () => ({
  renderHtmlToPdf: vi.fn(),
  getBrowser: async () => ({
    newPage: async () => ({ setRequestInterception: async () => {}, on: () => {}, evaluate, close: async () => {} }),
  }),
}))

const STORAGE = 'https://proj.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_URL = STORAGE

const { embedImages, printDocumentHtml } = await import('../render-print-document')
const { QuoteDocument } = await import('@/components/documents/QuoteDocument')
const { PhotosDocument } = await import('@/components/documents/PhotosDocument')

beforeEach(() => {
  evaluate.mockClear()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('missing')) return new Response('nope', { status: 404 })
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })
  }))
})

describe('embedImages', () => {
  it('embeds public files, storage images and photos; blanks anything else', async () => {
    const html = [
      '<img src="/logo-alt.png">',
      `<img src="${STORAGE}/storage/v1/object/public/tenant-assets/t/logo.png">`,
      `<img src="${STORAGE}/storage/v1/object/public/photos/j/1.jpg?width=800&amp;height=600">`,
      `<img src="${STORAGE}/storage/v1/object/public/photos/missing.jpg">`,
      '<img src="https://elsewhere.example/x.png">',
    ].join('')
    const out = await embedImages(html)
    const srcs = [...out.matchAll(/ src="([^"]*)"/g)].map(m => m[1])

    expect(srcs[0]).toMatch(/^data:image\/png;base64,/)
    expect(srcs[1]).toBe('data:image/png;base64,AQID')
    // Photos: fetched without the ignored size hints, then shrunk
    expect(fetch).toHaveBeenCalledWith(`${STORAGE}/storage/v1/object/public/photos/j/1.jpg`, expect.anything())
    expect(srcs[2]).toBe('data:image/png;base64,AQID#shrunk')
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(srcs[3]).toBe('')
    expect(srcs[4]).toBe('')
    expect(out).not.toContain('http')
  })
})

describe('printDocumentHtml', () => {
  it('wraps the document as the app layout does, with its CSS and fonts, and no print button', async () => {
    const html = await printDocumentHtml(
      <QuoteDocument quote={fx.printQuote()} scopeItems={fx.printScopeItems()} job={fx.printJob()} tenant={fx.printTenant()} />,
      'Q-1 <test>',
    )
    expect(html).toContain('<html lang="en" class="h-full antialiased">')
    expect(html).toContain('<body class="min-h-full flex flex-col">')
    expect(html).toContain('<title>Q-1 &lt;test&gt;</title>')
    expect(html).toContain("font-family: 'DM Sans'")
    expect(html).toContain("font-family: 'Times New Roman'")
    expect(html).toContain('.max-w-4xl{')
    expect(html).not.toContain('Print / Save as PDF')
    // User text is escaped by React
    expect(html).toContain('Remove and replace damaged floor tiles &lt;approx 4m²&gt;')
    expect(html).toContain('CLM-555 &lt;A&amp;B&gt;')
    expect(html).not.toMatch(/ src="\//)
    expect(html).not.toContain('rel="preload"')
  })

  it('renders the photo pages with every chosen photo', async () => {
    const photos = fx.printPhotos(7)
    const html = await printDocumentHtml(<PhotosDocument job={fx.printJob()} photos={photos} />, 'Photos')
    expect(html.match(/class="print-page"/g)).toHaveLength(2)
    expect(html.match(/<img /g)!.length).toBe(7 + 2) // photos + one logo per page
  })
})
