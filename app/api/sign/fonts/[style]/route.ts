import { NextRequest, NextResponse } from 'next/server'
import { loadSignatureFontBytes } from '@/lib/signing/pdf/fonts'
import { SIGNATURE_STYLES } from '@/lib/signing/signature-styles'

// Public. The script fonts for typed signatures, served by the app itself
// (no CDN) — the same files the PDF stamper embeds.
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ style: string }> }) {
  const { style } = await params
  if (!SIGNATURE_STYLES.some(s => s.key === style)) return new NextResponse('Not found', { status: 404 })
  const bytes = await loadSignatureFontBytes(style)
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'font/ttf',
      'Content-Length': String(bytes.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
