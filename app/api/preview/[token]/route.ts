import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { PreviewError, readPreviewToken, renderPreview } from '@/lib/documents/preview'
import { DocumentSendError } from '@/lib/documents/send/documents'
import { PrintDataError } from '@/lib/documents/print-data'
import { WorkOrderPdfError } from '@/lib/work-orders/work-order-pdf'

// GET /api/preview/<token> — a document's PDF exactly as it would be sent,
// from a link the voice connector handed out (preview_document,
// lib/documents/preview.ts). Public: the signed token names the tenant and the
// one document, and runs out after a day. Rendered live, never stored, and
// nothing is marked sent.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '')
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

const gone = () => new NextResponse('This preview link has run out or isn\'t valid. Ask Claude for the document again.', {
  status: 404,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
})

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const read = readPreviewToken(decodeURIComponent(token))
  if (!read) return gone()
  try {
    const { pdf, filename } = await renderPreview(read.target, { supabase: createServiceClient(), tenantId: read.tenantId })
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': contentDisposition(filename),
        'Content-Length': String(pdf.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) {
    if (err instanceof PreviewError || err instanceof DocumentSendError || err instanceof PrintDataError || err instanceof WorkOrderPdfError) {
      return NextResponse.json({ error: err.message }, { status: err.status === 401 ? 404 : err.status })
    }
    console.error('[preview] failed:', err)
    return NextResponse.json({ error: 'Failed to make the PDF' }, { status: 500 })
  }
}
