import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { CONSENT_TEXT } from '@/lib/signing/config'
import { describeDevice, formatPerthDateTime, formatUtcDateTime } from '@/lib/signing/format'
import { embedSansFonts } from './fonts'

// The "Signature Certificate" page appended to every signed document.
//
// A file can't contain its own hash, so the certificate records the hash of
// the source document and of the signed document as it was before this page
// was added. The SHA-256 of the complete file (with this page) is stored in
// signing_requests.signed_pdf_sha256 and the audit trail.

export interface CertificateData {
  requestId: string
  documentTitle: string
  jobNumber: string | null
  propertyAddress: string | null
  companyName: string
  /** Name the signer confirmed when signing */
  signerName: string
  /** e.g. "Joint owner", "Authorised person signing for the owner (Alex Example)" */
  signedAs: string
  /** Who the request was addressed to, if different from the signer's confirmed name */
  addressedTo: string | null
  signerEmail: string | null
  signerPhone: string | null
  signatureMethod: 'typed' | 'drawn'
  createdAt: Date
  sentAt: Date | null
  viewedAt: Date | null
  signedAt: Date
  ip: string | null
  userAgent: string | null
  sourceSha256: string
  /** SHA-256 of the stamped document before this page was appended */
  stampedSha256: string
  /** Pages in the document before this certificate */
  documentPageCount: number
}

const A4 = { width: 595.28, height: 841.89 }
const MARGIN = 48
const DARK = rgb(0.1, 0.1, 0.1)
const MUTED = rgb(0.4, 0.4, 0.4)
const RULE = rgb(0.85, 0.83, 0.8)
const ACCENT = rgb(0.79, 0.66, 0.43)

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(next, size) <= maxWidth) {
        line = next
        continue
      }
      if (line) lines.push(line)
      // A single word wider than the line (a hash, a user agent) is broken by characters
      let rest = word
      while (font.widthOfTextAtSize(rest, size) > maxWidth) {
        let cut = rest.length
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--
        lines.push(rest.slice(0, cut))
        rest = rest.slice(cut)
      }
      line = rest
    }
    lines.push(line)
  }
  return lines
}

class Writer {
  y: number
  constructor(private page: PDFPage, private fonts: { sans: PDFFont; sansBold: PDFFont }) {
    this.y = A4.height - MARGIN
  }

  text(value: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; width?: number; gap?: number } = {}) {
    const size = opts.size ?? 9.5
    const font = opts.bold ? this.fonts.sansBold : this.fonts.sans
    const x = opts.x ?? MARGIN
    const width = opts.width ?? A4.width - MARGIN - x
    for (const line of wrap(value, font, size, width)) {
      this.page.drawText(line, { x, y: this.y - size, size, font, color: opts.color ?? DARK })
      this.y -= size + 3
    }
    this.y -= opts.gap ?? 0
  }

  row(label: string, value: string) {
    const labelWidth = 150
    const startY = this.y
    this.text(label, { size: 9, color: MUTED, width: labelWidth - 8 })
    const afterLabel = this.y
    this.y = startY
    this.text(value || '—', { size: 9.5, x: MARGIN + labelWidth })
    this.y = Math.min(this.y, afterLabel) - 3
  }

  section(title: string) {
    this.y -= 8
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: A4.width - MARGIN, y: this.y }, thickness: 0.6, color: RULE })
    this.y -= 6
    this.text(title.toUpperCase(), { size: 8.5, bold: true, color: ACCENT, gap: 4 })
  }
}

function when(date: Date | null): string {
  return date ? `${formatPerthDateTime(date)}   (${formatUtcDateTime(date)})` : '—'
}

export async function appendCertificatePage(pdf: Uint8Array, data: CertificateData): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf)
  doc.registerFontkit(fontkit)
  const fonts = await embedSansFonts(doc)
  const page = doc.addPage([A4.width, A4.height])
  const w = new Writer(page, fonts)

  w.text('Signature Certificate', { size: 20, bold: true, gap: 2 })
  w.text(`${data.companyName} · electronic signature record`, { size: 10, color: MUTED, gap: 6 })

  w.section('Document')
  w.row('Document', data.documentTitle)
  w.row('Property', data.propertyAddress ?? '—')
  w.row('Job number', data.jobNumber ?? '—')
  w.row('Request ID', data.requestId)
  w.row('Pages signed', `Pages 1–${data.documentPageCount} of this file (this certificate is page ${data.documentPageCount + 1})`)

  w.section('Signer')
  w.row('Name', data.signerName)
  w.row('Signed as', data.signedAs)
  if (data.addressedTo && data.addressedTo !== data.signerName) w.row('Request sent to', data.addressedTo)
  w.row('Email', data.signerEmail ?? '—')
  w.row('Phone', data.signerPhone ?? '—')
  w.row('Signature', data.signatureMethod === 'typed' ? 'Typed name in a script style, adopted by the signer' : 'Drawn by the signer on their device')
  w.row('Consent', `The signer tapped Finish after being shown: "${CONSENT_TEXT}"`)

  w.section('Signed')
  w.row('Perth time', formatPerthDateTime(data.signedAt))
  w.row('UTC', formatUtcDateTime(data.signedAt))
  w.row('IP address', data.ip ?? 'Not recorded')
  w.row('Device', describeDevice(data.userAgent))
  w.row('Browser details', data.userAgent ?? 'Not recorded')

  w.section('Timeline')
  w.row('Created', when(data.createdAt))
  w.row('Sent to signer', when(data.sentAt))
  w.row('First opened', when(data.viewedAt))
  w.row('Signed', when(data.signedAt))

  w.section('Integrity (SHA-256)')
  w.row('Source document', data.sourceSha256)
  w.row(`Signed document (pages 1–${data.documentPageCount})`, data.stampedSha256)
  w.text(
    'The SHA-256 of this complete file, including this certificate, is kept in the audit trail for this request. '
      + 'Any change to the file after signing will produce a different value.',
    { size: 8.5, color: MUTED, gap: 4 },
  )

  page.drawText(`Generated by IRC Master e-signing · Request ${data.requestId}`, {
    x: MARGIN,
    y: MARGIN - 18,
    size: 7.5,
    font: fonts.sans,
    color: MUTED,
  })

  return doc.save()
}
