import { NextRequest, NextResponse } from 'next/server'
import { openExcessInvoice } from '@/lib/signing/in-house/signer'
import { SIGNER_CONTACT } from '@/lib/signing/config'
import { SigningError } from '@/lib/signing/provider'
import { requestMeta } from '@/lib/signing/request-meta'

// Public (no login). The excess invoice emailed with this signing request,
// exactly as sent, while the link is open (and briefly after signing).
// Never cached.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TEXT = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' }

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '')
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    const doc = await openExcessInvoice(token, requestMeta(req.headers))
    if (!doc) return NextResponse.redirect(new URL(`/sign/${encodeURIComponent(token)}`, req.url), 303)
    return new NextResponse(new Uint8Array(doc.pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': contentDisposition(doc.filename),
        'Content-Length': String(doc.pdf.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    })
  } catch (err) {
    if (err instanceof SigningError && err.status === 429) return new NextResponse(err.message, { status: 429, headers: TEXT })
    console.error('[sign/invoice] failed:', err)
    return new NextResponse(`Sorry, the invoice could not be opened here. It is also attached to the email we sent you — or call ${SIGNER_CONTACT.phone} and we’ll send it again.`, { status: 500, headers: TEXT })
  }
}
