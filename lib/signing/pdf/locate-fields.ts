import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFString, PDFHexString } from 'pdf-lib'
import { FIELD_MARKER_PREFIX } from '@/lib/pdf/field-markers'
import type { LocatedSignatureField, PdfRect } from '@/lib/signing/types'

// Finding signature fields in a generated PDF.
//
// Document templates mark each field with an invisible link
// (lib/pdf/field-markers.ts). Chrome writes every link into the PDF as a
// Link annotation carrying the exact page and rectangle it landed on, so a
// field is found wherever the content flowed (a long scope pushes the
// signing page later). The marker annotations are removed once read.
//
// Document-type config (lib/signing/documents/registry.ts) says which anchor
// each field uses, or gives fixed coordinates instead.

const ANCHOR_PREFIX = FIELD_MARKER_PREFIX

export type FieldPlacement =
  | { anchor: string }
  /** Fixed position. page < 0 counts from the end (-1 = last page). */
  | { page: number; x: number; y: number; width: number; height: number }

export interface SignatureFieldConfig {
  id: string
  /** Shown to the signer as the step name, e.g. "Receipt of documents" */
  label: string
  signature: FieldPlacement
  date?: FieldPlacement
  name?: FieldPlacement
}

export class FieldLocationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FieldLocationError'
  }
}

function decodeUri(value: unknown): string | null {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText()
  return null
}

function rectOf(annot: PDFDict, page: number): PdfRect | null {
  const rect = annot.lookupMaybe(PDFName.of('Rect'), PDFArray)
  if (!rect || rect.size() !== 4) return null
  const [x1, y1, x2, y2] = rect.asArray().map(n => (n instanceof PDFNumber ? n.asNumber() : NaN))
  if ([x1, y1, x2, y2].some(Number.isNaN)) return null
  return {
    page,
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  }
}

/**
 * Reads every signing anchor in the document and removes the marker
 * annotations. If an anchor's link was split across lines, the rectangles on
 * its first page are merged.
 */
export function extractSigningAnchors(doc: PDFDocument): Map<string, PdfRect> {
  const anchors = new Map<string, PdfRect>()

  doc.getPages().forEach((page, pageIndex) => {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) return

    const keep: (PDFRef | PDFDict)[] = []
    for (let i = 0; i < annots.size(); i++) {
      const raw = annots.get(i)
      const annot = annots.lookupMaybe(i, PDFDict)
      const action = annot?.lookupMaybe(PDFName.of('A'), PDFDict)
      const uri = action ? decodeUri(action.lookup(PDFName.of('URI'))) : null

      if (!annot || !uri || !uri.startsWith(ANCHOR_PREFIX)) {
        keep.push(raw as PDFRef | PDFDict)
        continue
      }

      const name = decodeURIComponent(uri.slice(ANCHOR_PREFIX.length))
      const rect = rectOf(annot, pageIndex)
      if (!rect) continue
      const existing = anchors.get(name)
      if (!existing) {
        anchors.set(name, rect)
      } else if (existing.page === pageIndex) {
        const x = Math.min(existing.x, rect.x)
        const y = Math.min(existing.y, rect.y)
        anchors.set(name, {
          page: pageIndex,
          x,
          y,
          width: Math.max(existing.x + existing.width, rect.x + rect.width) - x,
          height: Math.max(existing.y + existing.height, rect.y + rect.height) - y,
        })
      }
    }

    if (keep.length === annots.size()) return
    if (keep.length === 0) {
      page.node.delete(PDFName.of('Annots'))
    } else {
      page.node.set(PDFName.of('Annots'), doc.context.obj(keep))
    }
  })

  return anchors
}

function resolvePlacement(
  placement: FieldPlacement,
  anchors: Map<string, PdfRect>,
  pageCount: number,
  what: string,
): PdfRect {
  if ('anchor' in placement) {
    const rect = anchors.get(placement.anchor)
    if (!rect) throw new FieldLocationError(`Signing field "${what}" not found in the document (anchor "${placement.anchor}")`)
    return rect
  }
  const page = placement.page < 0 ? pageCount + placement.page : placement.page
  if (page < 0 || page >= pageCount) {
    throw new FieldLocationError(`Signing field "${what}" is on page ${placement.page}, but the document has ${pageCount} pages`)
  }
  return { page, x: placement.x, y: placement.y, width: placement.width, height: placement.height }
}

/**
 * Locates the configured fields in a freshly generated PDF. Returns the PDF
 * with the marker annotations removed (this is the source document the
 * signer sees and signs) and the located fields in signing order.
 */
export async function locateSignatureFields(
  pdf: Uint8Array,
  configs: SignatureFieldConfig[],
): Promise<{ pdf: Uint8Array; fields: LocatedSignatureField[] }> {
  if (configs.length === 0) throw new FieldLocationError('A signing document needs at least one signature field')

  const doc = await PDFDocument.load(pdf)
  const anchors = extractSigningAnchors(doc)
  const pageCount = doc.getPageCount()

  const fields = configs.map(cfg => ({
    id: cfg.id,
    label: cfg.label,
    signature: resolvePlacement(cfg.signature, anchors, pageCount, `${cfg.id}.signature`),
    date: cfg.date ? resolvePlacement(cfg.date, anchors, pageCount, `${cfg.id}.date`) : null,
    name: cfg.name ? resolvePlacement(cfg.name, anchors, pageCount, `${cfg.id}.name`) : null,
  }))

  return { pdf: await doc.save(), fields }
}
