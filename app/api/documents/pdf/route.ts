import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/get-user'
import { createClient } from '@/lib/supabase/server'
import { DocumentSendError, parseDocumentRef, prepareDocument } from '@/lib/documents/send/documents'
import { PrintDataError } from '@/lib/documents/print-data'

// The PDF exactly as it would be emailed, rendered live and never stored.
// Always inline. Query: kind, id; TCC adds date, time, completedBy, method;
// photos adds ids (comma-separated).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '')
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user?.tenant_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const ctx = { supabase: await createClient(), tenantId: user.tenant_id }

  const q = req.nextUrl.searchParams
  try {
    const ref = parseDocumentRef({
      kind: q.get('kind'),
      id: q.get('id'),
      tcc: { date: q.get('date') ?? '', time: q.get('time') ?? '', completedBy: q.get('completedBy') ?? '', method: q.get('method') ?? '' },
      photoIds: (q.get('ids') ?? '').split(',').filter(Boolean),
    })
    const doc = await prepareDocument(ref, ctx)
    const pdf = await doc.render()
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': contentDisposition(doc.filename),
        'Content-Length': String(pdf.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) {
    if (err instanceof DocumentSendError || err instanceof PrintDataError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[documents/pdf] failed:', err)
    return NextResponse.json({ error: 'Failed to generate the PDF' }, { status: 500 })
  }
}
