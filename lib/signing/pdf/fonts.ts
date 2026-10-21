import { readFile } from 'node:fs/promises'
import path from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import type { PDFDocument, PDFFont } from 'pdf-lib'
import { signatureStyleFor } from '@/lib/signing/signature-styles'

// Font files for stamping. Script fonts live in lib/signing/fonts; the
// certificate and printed name/date use Liberation Sans from lib/pdf/fonts
// (Arial metrics, wide Latin coverage — pdf-lib's built-in Helvetica can't
// encode names like "Nguyễn"). Routes that stamp must list both folders in
// next.config.ts outputFileTracingIncludes.

const SIGNING_FONT_DIR = path.join(process.cwd(), 'lib', 'signing', 'fonts')
const PDF_FONT_DIR = path.join(process.cwd(), 'lib', 'pdf', 'fonts')

const cache = new Map<string, Promise<Buffer>>()

function load(file: string): Promise<Buffer> {
  let p = cache.get(file)
  if (!p) {
    p = readFile(file).catch(err => {
      cache.delete(file)
      throw err
    })
    cache.set(file, p)
  }
  return p
}

export function loadSignatureFontBytes(styleKey: string | null | undefined): Promise<Buffer> {
  return load(path.join(SIGNING_FONT_DIR, signatureStyleFor(styleKey).file))
}

export function loadSansFontBytes(weight: 'regular' | 'bold' = 'regular'): Promise<Buffer> {
  return load(path.join(PDF_FONT_DIR, weight === 'bold' ? 'LiberationSans-Bold.ttf' : 'LiberationSans-Regular.ttf'))
}

export interface DocumentFonts {
  sans: PDFFont
  sansBold: PDFFont
}

export async function embedSansFonts(doc: PDFDocument): Promise<DocumentFonts> {
  doc.registerFontkit(fontkit)
  const [regular, bold] = await Promise.all([loadSansFontBytes('regular'), loadSansFontBytes('bold')])
  const [sans, sansBold] = await Promise.all([
    doc.embedFont(regular, { subset: true }),
    doc.embedFont(bold, { subset: true }),
  ])
  return { sans, sansBold }
}

/** True when every character of text has a glyph in the font file. */
export async function fontCoversText(fontBytes: Buffer, text: string): Promise<boolean> {
  const font = fontkit.create(fontBytes) as unknown as { hasGlyphForCodePoint(cp: number): boolean }
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp === 0x20) continue
    if (!font.hasGlyphForCodePoint(cp)) return false
  }
  return true
}
