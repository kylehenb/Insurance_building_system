import { NextRequest, NextResponse } from 'next/server'
import { buildWorkOrderPdf, WorkOrderPdfError } from '@/lib/work-orders/work-order-pdf'

// Live Work Order PDF — rendered with headless Chromium on every request,
// never stored. ?download=1 forces a download; otherwise it opens inline.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '')
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Work order not found' }, { status: 404 })
  }

  const started = Date.now()
  try {
    const { pdf, filename } = await buildWorkOrderPdf(id)
    const download = req.nextUrl.searchParams.get('download') === '1'

    console.log(`Work order PDF ${id}: ${pdf.length} bytes in ${Date.now() - started}ms`)

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': contentDisposition(download ? 'attachment' : 'inline', filename),
        'Content-Length': String(pdf.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) {
    if (err instanceof WorkOrderPdfError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error(`Work order PDF ${id} failed after ${Date.now() - started}ms:`, err)
    return NextResponse.json({ error: 'Failed to generate work order PDF' }, { status: 500 })
  }
}
