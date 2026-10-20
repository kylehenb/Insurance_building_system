import type { Browser, PDFOptions } from 'puppeteer-core'

// Server-side HTML → PDF rendering on Vercel Functions.
//
// Environment detection:
//   - Vercel (or any Lambda-style runtime): puppeteer-core + @sparticuz/chromium,
//     which ships a Lambda/Vercel-compatible Chromium binary inside node_modules.
//   - Local with CHROME_EXECUTABLE_PATH set: puppeteer-core driving that Chrome.
//   - Local otherwise: full `puppeteer` (devDependency) with its own downloaded Chrome.
//
// The HTML must be fully self-contained (inline CSS, data: URI images). All
// network requests from the page are blocked and JavaScript is disabled, so
// nothing in a template can reach out to the network or run code.

function isServerlessRuntime(): boolean {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
}

async function launchBrowser(): Promise<Browser> {
  if (isServerlessRuntime()) {
    const [{ default: chromium }, { default: puppeteer }] = await Promise.all([
      import('@sparticuz/chromium'),
      import('puppeteer-core'),
    ])
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    })
  }

  // Chrome refuses to start as root (Docker / CI containers) without --no-sandbox.
  const args = process.getuid?.() === 0 ? ['--no-sandbox'] : []

  const localChrome = process.env.CHROME_EXECUTABLE_PATH
  if (localChrome) {
    const { default: puppeteer } = await import('puppeteer-core')
    return puppeteer.launch({ executablePath: localChrome, headless: true, args })
  }

  const { default: puppeteer } = await import('puppeteer')
  return puppeteer.launch({ headless: true, args }) as unknown as Promise<Browser>
}

// Reuse one browser per warm function instance (Fluid compute keeps instances
// alive between requests), so only the first request pays Chromium's cold start.
let browserPromise: Promise<Browser> | null = null

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const existing = await browserPromise.catch(() => null)
    if (existing?.connected) return existing
  }
  browserPromise = launchBrowser()
  const browser = await browserPromise.catch(err => {
    browserPromise = null
    throw err
  })
  browser.on('disconnected', () => { browserPromise = null })
  return browser
}

export interface RenderPdfOptions {
  /** Small HTML snippet rendered in the page footer. Supports Chrome's
   *  <span class="pageNumber"> / <span class="totalPages"> placeholders. */
  footerTemplate?: string
}

export async function renderHtmlToPdf(html: string, options: RenderPdfOptions = {}): Promise<Buffer> {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setJavaScriptEnabled(false)
    await page.setRequestInterception(true)
    page.on('request', request => {
      if (request.url().startsWith('data:')) request.continue()
      else request.abort()
    })

    await page.setContent(html, { waitUntil: 'load', timeout: 20_000 })
    await page.emulateMediaType('print')

    const pdfOptions: PDFOptions = {
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '0', bottom: options.footerTemplate ? '14mm' : '12mm', left: '0' },
      displayHeaderFooter: !!options.footerTemplate,
      headerTemplate: '<span></span>',
      footerTemplate: options.footerTemplate ?? '<span></span>',
    }

    const pdf = await page.pdf(pdfOptions)
    return Buffer.from(pdf)
  } finally {
    await page.close().catch(() => undefined)
  }
}
