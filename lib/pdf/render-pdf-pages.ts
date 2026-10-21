import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getBrowser } from './render-html-to-pdf'

// PDF → one image per page, using pdf.js inside the same headless Chromium
// that renders our PDFs (no native image libraries needed). Used to show the
// signer the real document pages.
//
// The page is blank and offline: pdf.js and its worker code are loaded from
// local files as blob: URLs and every network request is blocked.

const PDFJS_DIR = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'build')

let sources: Promise<{ lib: string; worker: string }> | null = null
function pdfjsSources() {
  sources ??= Promise.all([
    readFile(path.join(PDFJS_DIR, 'pdf.min.mjs'), 'utf8'),
    readFile(path.join(PDFJS_DIR, 'pdf.worker.min.mjs'), 'utf8'),
  ]).then(([lib, worker]) => ({ lib, worker }))
  sources.catch(() => { sources = null })
  return sources
}

interface PageInput {
  lib: string
  worker: string
  pdfBase64: string
  widthPx: number
  type: string
  quality: number
}

const IN_PAGE_RENDER = `(async () => {
  const input = window.__pdfInput;
  delete window.__pdfInput;
  const blobUrl = src => URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const pdfjs = await import(blobUrl(input.lib));
  // A blank page has an opaque origin, where module workers can't start:
  // preloading the worker module makes pdf.js run it on the main thread.
  globalThis.pdfjsWorker = await import(blobUrl(input.worker));
  const bin = atob(input.pdfBase64);
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: input.widthPx / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    out.push({ widthPt: base.width, heightPt: base.height, dataUrl: canvas.toDataURL(input.type, input.quality) });
    page.cleanup();
  }
  await doc.destroy();
  return out;
})()`

export interface RenderedPdfPage {
  /** Page size in PDF points */
  widthPt: number
  heightPt: number
  image: Buffer
  contentType: 'image/png' | 'image/jpeg'
}

export interface RenderPdfPagesOptions {
  /** Image width in pixels (default 1240 ≈ A4 at 150 dpi) */
  widthPx?: number
  format?: 'png' | 'jpeg'
  /** JPEG quality 0–1 (default 0.88) */
  quality?: number
}

export async function renderPdfPages(pdf: Uint8Array, options: RenderPdfPagesOptions = {}): Promise<RenderedPdfPage[]> {
  const { lib, worker } = await pdfjsSources()
  const mime = options.format === 'jpeg' ? 'image/jpeg' : 'image/png'
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setRequestInterception(true)
    page.on('request', request => {
      const url = request.url()
      if (url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') request.continue()
      else request.abort()
    })
    await page.setContent('<!DOCTYPE html><html><head></head><body></body></html>')

    // Inputs go in as arguments; the code runs as a string so no bundler
    // rewrites its dynamic import().
    await page.evaluate((input: PageInput) => { (window as unknown as { __pdfInput: PageInput }).__pdfInput = input }, {
      lib,
      worker,
      pdfBase64: Buffer.from(pdf).toString('base64'),
      widthPx: options.widthPx ?? 1240,
      type: mime,
      quality: options.quality ?? 0.88,
    })
    const rendered = (await page.evaluate(IN_PAGE_RENDER)) as { widthPt: number; heightPt: number; dataUrl: string }[]

    return rendered.map(p => ({
      widthPt: p.widthPt,
      heightPt: p.heightPt,
      image: Buffer.from(p.dataUrl.slice(p.dataUrl.indexOf(',') + 1), 'base64'),
      contentType: mime,
    }))
  } finally {
    await page.close().catch(() => undefined)
  }
}
