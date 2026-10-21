import { NextRequest, NextResponse } from 'next/server'
import { openSourceDocument } from '@/lib/signing/in-house/signer'
import { SigningError } from '@/lib/signing/provider'
import { requestMeta } from '@/lib/signing/request-meta'

// Public (no login). The exact PDF being signed, while the link is open.
// Opens in the phone's own PDF viewer. Never cached.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '')
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    const doc = await openSourceDocument(token, requestMeta(req.headers))
    if (!doc) {
      // Back to the page, which explains (expired, signed, cancelled…)
      return NextResponse.redirect(new URL(`/sign/${encodeURIComponent(token)}`, req.url), 303)
    }
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
    if (err instanceof SigningError && err.status === 429) {
      return new NextResponse(err.message, { status: 429, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }
    console.error('[sign/document] failed:', err)
    return new NextResponse('Sorry, the document could not be opened. Please try again.', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}
