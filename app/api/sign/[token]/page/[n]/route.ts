import { NextRequest, NextResponse } from 'next/server'
import { openPageImage } from '@/lib/signing/in-house/signer'
import { SigningError } from '@/lib/signing/provider'
import { requestMeta } from '@/lib/signing/request-meta'

// Public (no login). Image of one page of the document being signed, while
// the link is open. The images never change for a request, so the browser
// may keep them briefly (private cache only).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TEXT = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' }

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string; n: string }> }) {
  const { token, n } = await params
  const pageNumber = /^\d{1,3}$/.test(n) ? Number(n) : NaN
  try {
    const image = await openPageImage(token, pageNumber, requestMeta(req.headers))
    if (!image) return new NextResponse('Not found', { status: 404, headers: TEXT })
    return new NextResponse(new Uint8Array(image), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(image.length),
        'Cache-Control': 'private, max-age=600',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    })
  } catch (err) {
    if (err instanceof SigningError && err.status === 429) return new NextResponse(err.message, { status: 429, headers: TEXT })
    console.error('[sign/page] failed:', err)
    return new NextResponse('Sorry, this page could not be loaded.', { status: 500, headers: TEXT })
  }
}
