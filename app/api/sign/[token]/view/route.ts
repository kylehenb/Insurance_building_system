import { NextRequest, NextResponse } from 'next/server'
import { recordSignerView } from '@/lib/signing/in-house/signer'
import { requestMeta } from '@/lib/signing/request-meta'

// Public (no login). Called by the signer page's script once the page has
// loaded in a real browser, so email link scanners don't count as a view.
// Always 204: it reveals nothing about the token.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    await recordSignerView(token, requestMeta(req.headers))
  } catch (err) {
    console.error('[sign/view] failed:', err)
  }
  return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
