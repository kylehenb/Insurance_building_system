import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import type { LocatedSignatureField, PdfRect } from '@/lib/signing/types'
import { formatSigningDate } from '@/lib/signing/format'
import { signatureStyleFor } from '@/lib/signing/signature-styles'
import { embedSansFonts, fontCoversText, loadSansFontBytes, loadSignatureFontBytes } from './fonts'

// Stamps the signer's signature (plus the date and printed name where the
// document has blanks for them) onto every signature field.

export type SignatureInput =
  | { method: 'typed'; text: string; styleKey: string }
  | { method: 'drawn'; png: Uint8Array }

export interface StampInput {
  sourcePdf: Uint8Array
  fields: LocatedSignatureField[]
  signature: SignatureInput
  /** Printed name as it should appear, e.g. "Jane Citizen (joint owner)" or "John Smith for Alex Example" */
  printedName: string
  /** The authorised person's own name when they sign for the owner; null otherwise */
  representativeName: string | null
  signedAt: Date
  requestId: string
}

const INK = rgb(0.05, 0.12, 0.35)       // dark blue-black, like pen ink
const TEXT = rgb(0.1, 0.1, 0.1)
const CAPTION = rgb(0.42, 0.42, 0.42)

function fitTextSize(font: PDFFont, text: string, maxSize: number, box: { width: number; height: number }): number {
  let size = maxSize
  const widthAt = (s: number) => font.widthOfTextAtSize(text, s)
  const heightAt = (s: number) => font.heightAtSize(s, { descender: true })
  while (size > 6 && (widthAt(size) > box.width || heightAt(size) > box.height)) size -= 0.5
  return size
}

function drawFittedText(page: PDFPage, text: string, rect: PdfRect, font: PDFFont, maxSize: number) {
  if (!text) return
  const pad = 2
  const box = { width: Math.max(rect.width - pad * 2, 10), height: Math.max(rect.height - 1, 6) }
  const size = fitTextSize(font, text, maxSize, box)
  // Sit the text on the blank's baseline (its bottom edge), just above the line.
  const descent = Math.abs(font.heightAtSize(size, { descender: true }) - font.heightAtSize(size, { descender: false }))
  page.drawText(text, { x: rect.x + pad, y: rect.y + Math.max(descent, 1.5), size, font, color: TEXT })
}

function drawSignature(
  page: PDFPage,
  rect: PdfRect,
  signature: { kind: 'text'; text: string; font: PDFFont; maxSize: number } | { kind: 'image'; image: PDFImage },
) {
  const pad = 2
  const box = { x: rect.x + pad, y: rect.y + pad, width: rect.width - pad * 2, height: rect.height - pad * 2 }

  if (signature.kind === 'image') {
    const scale = Math.min(box.width / signature.image.width, box.height / signature.image.height)
    const w = signature.image.width * scale
    const h = signature.image.height * scale
    page.drawImage(signature.image, { x: box.x, y: box.y + (box.height - h) / 2, width: w, height: h })
    return
  }

  const size = fitTextSize(signature.font, signature.text, signature.maxSize, box)
  const height = signature.font.heightAtSize(size, { descender: true })
  const descent = height - signature.font.heightAtSize(size, { descender: false })
  page.drawText(signature.text, {
    x: box.x,
    y: box.y + Math.max((box.height - height) / 2, 0) + Math.abs(descent),
    size,
    font: signature.font,
    color: INK,
  })
}

export async function stampSignatures(input: StampInput): Promise<Uint8Array> {
  const doc = await PDFDocument.load(input.sourcePdf)
  doc.registerFontkit(fontkit)
  const { sans } = await embedSansFonts(doc)
  const pages = doc.getPages()

  let signature: Parameters<typeof drawSignature>[2]
  if (input.signature.method === 'drawn') {
    signature = { kind: 'image', image: await doc.embedPng(input.signature.png) }
  } else {
    const style = signatureStyleFor(input.signature.styleKey)
    const scriptBytes = await loadSignatureFontBytes(style.key)
    // A name the script font can't draw (e.g. non-Latin letters) is written
    // in the plain font rather than as empty boxes.
    const covered = await fontCoversText(scriptBytes, input.signature.text)
    const font = covered
      ? await doc.embedFont(scriptBytes, { subset: true })
      : await doc.embedFont(await loadSansFontBytes('regular'), { subset: true })
    signature = { kind: 'text', text: input.signature.text, font, maxSize: covered ? style.pdfSize : 16 }
  }

  const dateText = formatSigningDate(input.signedAt)
  const ref = input.requestId.slice(0, 8).toUpperCase()
  const fullCaption = `Signed electronically by ${input.printedName} · ${dateText} · Ref ${ref}`
  const shortCaption = `Signed electronically ${dateText} · Ref ${ref}`

  for (const field of input.fields) {
    const page = pages[field.signature.page]
    if (!page) throw new Error(`Signature field ${field.id} points at missing page ${field.signature.page}`)
    drawSignature(page, field.signature, signature)

    const captionSize = 5.5
    const captionY = Math.max(field.signature.y - captionSize - 1.5, 2)
    // A printed-name line directly under the signature already says who
    // signed (and would collide with the caption), so the caption is left off.
    const nameRightBelow = !!field.name && field.name.page === field.signature.page
      && field.name.y + field.name.height > captionY - 2 && field.name.y < field.signature.y
    if (!nameRightBelow) {
      // Name the signer in the caption when it fits under the signature box
      const caption = sans.widthOfTextAtSize(fullCaption, captionSize) <= Math.max(field.signature.width, 150) ? fullCaption : shortCaption
      page.drawText(caption, { x: field.signature.x + 2, y: captionY, size: captionSize, font: sans, color: CAPTION })
    }

    if (field.date) drawFittedText(pages[field.date.page], dateText, field.date, sans, 9)
    if (field.name) drawFittedText(pages[field.name.page], input.printedName, field.name, sans, 9)
    if (field.representative && input.representativeName) {
      drawFittedText(pages[field.representative.page], input.representativeName, field.representative, sans, 9)
    }
  }

  return doc.save()
}

/** Validates a drawn signature upload: a PNG of sensible size. */
export function parseDrawnSignature(dataUrl: string | null | undefined): Uint8Array | null {
  if (!dataUrl) return null
  const m = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/)
  if (!m) return null
  const bytes = Buffer.from(m[1], 'base64')
  // PNG signature, and between 200 bytes and 1.5 MB
  const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  if (!isPng || bytes.length < 200 || bytes.length > 1_500_000) return null
  return new Uint8Array(bytes)
}
