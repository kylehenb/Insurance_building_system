import { NextRequest, NextResponse } from 'next/server'
import { resolveSignerView } from '@/lib/signing/in-house/signer'
import { requestMeta } from '@/lib/signing/request-meta'
import { renderSignerErrorPage, renderSignerPage, SIGNER_PAGE_CSP } from '@/lib/signing/signer-page/render'

// Public signing page (no login): /sign/[token]
//
// Served as a complete HTML document rather than a React page, so it needs
// no JavaScript framework and works on older phones (see
// lib/signing/signer-page/render.ts). The token is looked up on the server
// with the service role; only that one document is shown.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const search = req.nextUrl.searchParams

  let html: string
  try {
    const view = await resolveSignerView(token, requestMeta(req.headers))
    html = renderSignerPage(view, { token, done: search.get('done'), error: search.get('error') })
  } catch (err) {
    console.error('[sign] page failed:', err)
    html = renderSignerErrorPage()
  }

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': SIGNER_PAGE_CSP,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    },
  })
}
