import type { ReactElement } from 'react'
import { renderHtmlToPdf, getBrowser } from '@/lib/pdf/render-html-to-pdf'
import { loadPrintPageFontCss } from '@/lib/pdf/fonts'
import { PRINT_PAGE_CSS } from '@/lib/pdf/print-page-css.generated'
import { loadPublicImageDataUri } from '@/lib/documents/document-assets'

// PDFs of the documents that are also browser print pages (quote, report,
// TCC, photo pages). The same React component the print page renders is
// turned into static HTML and printed by headless Chromium in the same
// surroundings the print page has in the app:
//   - the app's CSS for those classes (app/globals.css via Tailwind, generated
//     into print-page-css.generated.ts by scripts/build-print-css.mjs)
//   - the root layout's <html>/<body> classes (app/layout.tsx)
//   - the fonts next/font serves, plus Times New Roman for text without a font
//   - 1cm page margins (globals.css @page), print media, backgrounds on
//
// The renderer blocks the network, so every image is embedded first.

// Text with no font of its own: the app's font-sans variable refers to itself,
// so on the print pages it falls back to the browser default serif font.
// Named here so the embedded Times New Roman metric font is used.
const DEFAULT_FONT_CSS = 'html { font-family: \'Times New Roman\'; }'

// <html>/<body> classes from app/layout.tsx (also in scripts/build-print-css.mjs)
const HTML_CLASS = 'h-full antialiased'
const BODY_CLASS = 'min-h-full flex flex-col'

/** Photos are re-encoded no larger than this on their longest side. */
const MAX_PHOTO_PX = 1600
const PHOTO_JPEG_QUALITY = 0.85

function decodeAttr(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

function storagePublicPrefix(): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  return base ? `${base.replace(/\/$/, '')}/storage/v1/object/public/` : null
}

async function fetchDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const type = res.headers.get('content-type') ?? ''
    const mime = type.startsWith('image/') ? type.split(';')[0] : 'image/jpeg'
    return `data:${mime};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`
  } catch (err) {
    console.error(`[print-document] image download failed: ${url}`, err)
    return null
  }
}

/** A photo ready to embed, with its size as displayed (orientation applied). */
export interface PreparedPhoto {
  src: string
  width: number
  height: number
}

/**
 * Shrinks large photos in a scratch Chromium page (no network, nothing but
 * this canvas code runs) and measures them. Orientation is applied as the
 * browser shows it, so width/height are the photo as seen. A photo that
 * can't be decoded is returned as-is with no size (0 × 0).
 */
async function preparePhotos(dataUris: string[]): Promise<PreparedPhoto[]> {
  if (dataUris.length === 0) return []
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setRequestInterception(true)
    page.on('request', request => {
      if (request.url().startsWith('data:') || request.url() === 'about:blank') request.continue()
      else request.abort()
    })
    const results: PreparedPhoto[] = []
    for (const src of dataUris) {
      const out = await page.evaluate(async (s: string, maxPx: number, quality: number) => {
        const img = new Image()
        img.src = s
        await img.decode()
        const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight))
        if (scale === 1 && s.length < 1_500_000) return { src: s, width: img.naturalWidth, height: img.naturalHeight }
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.naturalWidth * scale)
        canvas.height = Math.round(img.naturalHeight * scale)
        const g = canvas.getContext('2d')!
        g.fillStyle = '#fff'
        g.fillRect(0, 0, canvas.width, canvas.height)
        g.drawImage(img, 0, 0, canvas.width, canvas.height)
        return { src: canvas.toDataURL('image/jpeg', quality), width: canvas.width, height: canvas.height }
      }, src, MAX_PHOTO_PX, PHOTO_JPEG_QUALITY).catch(err => {
        console.error('[print-document] photo resize failed, using the original', err)
        return { src, width: 0, height: 0 }
      })
      results.push(out)
    }
    return results
  } finally {
    await page.close().catch(() => undefined)
  }
}

/**
 * Photos from the photos bucket, downloaded, shrunk and measured, in the
 * order given. null where a photo couldn't be downloaded.
 */
export async function loadPhotoImages(storagePaths: string[]): Promise<(PreparedPhoto | null)[]> {
  const prefix = storagePublicPrefix()
  if (!prefix) return storagePaths.map(() => null)
  const downloaded = await Promise.all(storagePaths.map(path =>
    fetchDataUri(`${prefix}photos/${path.split('/').map(encodeURIComponent).join('/')}`)))
  const prepared = await preparePhotos(downloaded.filter((v): v is string => !!v))
  let next = 0
  return downloaded.map(uri => (uri ? prepared[next++] : null))
}

/** Replaces every <img src> with a data: URI (public files, tenant logos, photos). */
export async function embedImages(html: string): Promise<string> {
  const prefix = storagePublicPrefix()
  const srcs = [...new Set([...html.matchAll(/ src="([^"]*)"/g)].map(m => m[1]))]

  const resolved = new Map<string, string | null>()
  const photoKeys: string[] = []
  await Promise.all(srcs.map(async raw => {
    const url = decodeAttr(raw)
    if (url.startsWith('data:')) return
    if (url.startsWith('/') && !url.startsWith('//')) {
      resolved.set(raw, await loadPublicImageDataUri(url.slice(1).split('?')[0]))
    } else if (prefix && url.startsWith(prefix)) {
      const isPhoto = url.startsWith(`${prefix}photos/`)
      // ?width/height on the object URL are ignored by storage: fetch the file itself
      resolved.set(raw, await fetchDataUri(isPhoto ? url.split('?')[0] : url))
      if (isPhoto) photoKeys.push(raw)
    } else {
      resolved.set(raw, null)
    }
  }))

  const photoUris = photoKeys.map(k => resolved.get(k)).filter((v): v is string => !!v)
  const shrunk = await preparePhotos(photoUris)
  photoKeys.filter(k => resolved.get(k)).forEach((k, i) => resolved.set(k, shrunk[i].src))

  return html.replace(/ src="([^"]*)"/g, (match, raw: string) => {
    if (!resolved.has(raw)) return match
    const uri = resolved.get(raw)
    // A missing image renders as an empty box, as an offline browser would show it
    return uri ? ` src="${uri}"` : ' src=""'
  })
}

/** The full HTML page for a print-page document, ready for the PDF renderer. */
export async function printDocumentHtml(element: ReactElement, title: string): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server')
  // React adds <link rel="preload"> hints for images; the images are embedded instead
  const body = renderToStaticMarkup(element).replace(/<link rel="preload"[^>]*>/g, '')
  const fontCss = await loadPrintPageFontCss()
  const escTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!DOCTYPE html>
<html lang="en" class="${HTML_CLASS}">
<head>
<meta charset="utf-8">
<title>${escTitle}</title>
<style>${fontCss}</style>
<style>${PRINT_PAGE_CSS}</style>
<style>${DEFAULT_FONT_CSS}</style>
</head>
<body class="${BODY_CLASS}">${await embedImages(body)}</body>
</html>`
}

/** Renders a print-page document to PDF: A4, 1cm margins, as the browser prints it. */
export async function renderPrintDocumentPdf(element: ReactElement, title: string): Promise<Buffer> {
  return renderHtmlToPdf(await printDocumentHtml(element, title), { margin: '10mm' })
}
