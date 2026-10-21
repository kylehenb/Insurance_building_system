import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { fieldMarkerHref } from '@/lib/pdf/field-markers'
import { FieldLocationError, locateSignatureFields } from '../pdf/locate-fields'
import { stampSignatures } from '../pdf/stamp'
import { appendCertificatePage } from '../pdf/certificate'
import { fontCoversText, loadSignatureFontBytes } from '../pdf/fonts'
import { sha256Hex } from '../tokens'

// A PDF shaped like Chrome's output: field markers are Link annotations
// with a URI action, plus one ordinary link that must be left alone.
async function pdfWithMarkers(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const pages = [doc.addPage([595, 842]), doc.addPage([595, 842]), doc.addPage([595, 842])]
  const link = (uri: string, rect: number[]) => doc.context.register(doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: rect,
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(uri) },
  }))
  pages[1].node.set(PDFName.of('Annots'), doc.context.obj([
    link(fieldMarkerHref('sig_a'), [50, 100, 250, 140]),
    link('https://example.com/real-link', [10, 10, 60, 20]),
  ]))
  pages[2].node.set(PDFName.of('Annots'), doc.context.obj([
    link(fieldMarkerHref('sig_b'), [300, 600, 500, 630]),
    link(fieldMarkerHref('date_b'), [100, 600, 180, 612]),
  ]))
  return doc.save()
}

const FIELDS = [
  { id: 'a', label: 'First', signature: { anchor: 'sig_a' } },
  { id: 'b', label: 'Second', signature: { anchor: 'sig_b' }, date: { anchor: 'date_b' }, name: { page: -1, x: 10, y: 10, width: 100, height: 12 } },
]

describe('locateSignatureFields', () => {
  it('finds markers by page and rectangle, in config order', async () => {
    const { fields } = await locateSignatureFields(await pdfWithMarkers(), FIELDS)
    expect(fields.map(f => f.id)).toEqual(['a', 'b'])
    expect(fields[0].signature).toEqual({ page: 1, x: 50, y: 100, width: 200, height: 40 })
    expect(fields[1].signature.page).toBe(2)
    expect(fields[1].date).toEqual({ page: 2, x: 100, y: 600, width: 80, height: 12 })
    // fixed position, counted from the end
    expect(fields[1].name).toEqual({ page: 2, x: 10, y: 10, width: 100, height: 12 })
  })

  it('removes the markers but keeps ordinary links', async () => {
    const { pdf } = await locateSignatureFields(await pdfWithMarkers(), FIELDS)
    const doc = await PDFDocument.load(pdf)
    const annots = (i: number) => doc.getPages()[i].node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    expect(annots(1)?.size()).toBe(1)
    expect(annots(2)).toBeUndefined()
  })

  it('fails loudly when a configured field is missing', async () => {
    await expect(locateSignatureFields(await pdfWithMarkers(), [{ id: 'x', label: 'X', signature: { anchor: 'nope' } }]))
      .rejects.toBeInstanceOf(FieldLocationError)
    await expect(locateSignatureFields(await pdfWithMarkers(), [{ id: 'x', label: 'X', signature: { page: 9, x: 0, y: 0, width: 1, height: 1 } }]))
      .rejects.toBeInstanceOf(FieldLocationError)
  })
})

describe('stamping and certificate', () => {
  it('stamps typed and drawn signatures without changing the page count', async () => {
    const { pdf, fields } = await locateSignatureFields(await pdfWithMarkers(), FIELDS)
    const base = { sourcePdf: pdf, fields, signerName: 'Jane Citizen', signedAt: new Date('2026-10-21T01:00:00Z'), requestId: '12345678-0000-4000-8000-000000000000' }

    const typed = await stampSignatures({ ...base, signature: { method: 'typed', text: 'Jane Citizen', styleKey: 'allura' } })
    expect((await PDFDocument.load(typed)).getPageCount()).toBe(3)
    expect(sha256Hex(typed)).not.toBe(sha256Hex(pdf))

    // 1x1 transparent PNG
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))
    const drawn = await stampSignatures({ ...base, signature: { method: 'drawn', png } })
    expect((await PDFDocument.load(drawn)).getPageCount()).toBe(3)
  })

  it('falls back to a plain font for names the script font cannot draw', async () => {
    const bytes = await loadSignatureFontBytes('great_vibes')
    expect(await fontCoversText(bytes, 'Jane O’Brien-Smith')).toBe(true)
    expect(await fontCoversText(bytes, '王小明')).toBe(false)
    const { pdf, fields } = await locateSignatureFields(await pdfWithMarkers(), FIELDS)
    const stamped = await stampSignatures({
      sourcePdf: pdf, fields, signerName: 'Nguyễn Văn An', signedAt: new Date(), requestId: 'r',
      signature: { method: 'typed', text: 'Nguyễn Văn An', styleKey: 'great_vibes' },
    })
    expect(stamped.length).toBeGreaterThan(pdf.length)
  })

  it('appends one Signature Certificate page', async () => {
    const { pdf } = await locateSignatureFields(await pdfWithMarkers(), FIELDS)
    const withCert = await appendCertificatePage(pdf, {
      requestId: '12345678-0000-4000-8000-000000000000',
      documentTitle: 'Scope of Works Authorisation — 1 Example St',
      jobNumber: 'IRC1234',
      propertyAddress: '1 Example St',
      companyName: 'Insurance Repair Co',
      signerName: 'Jane Citizen',
      signerEmail: 'jane@example.com',
      signerPhone: null,
      signatureMethod: 'typed',
      createdAt: new Date(), sentAt: new Date(), viewedAt: null, signedAt: new Date(),
      ip: '203.0.113.9',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
      sourceSha256: 'a'.repeat(64),
      stampedSha256: 'b'.repeat(64),
      documentPageCount: 3,
    })
    expect((await PDFDocument.load(withCert)).getPageCount()).toBe(4)
  })
})
