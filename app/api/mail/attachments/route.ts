import { NextRequest, NextResponse } from 'next/server'
import { mailAccess } from '@/lib/mail/access'
import { getGmailClient } from '@/lib/gmail/client'

export const maxDuration = 60

// Shown in the browser rather than downloaded. Everything else (html, svg, …)
// is always a download so it can't run on our origin.
const VIEWABLE = /^(image\/(png|jpe?g|gif|webp|bmp)|application\/pdf|text\/plain)$/i

// GET /api/mail/attachments?m=<messageId>&a=<attachmentId>&n=<filename>&t=<mime>[&dl=1]
export async function GET(req: NextRequest): Promise<NextResponse> {
  const access = await mailAccess()
  if (access instanceof NextResponse) return access

  const p = req.nextUrl.searchParams
  const messageId = p.get('m') ?? ''
  const attachmentId = p.get('a') ?? ''
  const filename = (p.get('n') ?? 'attachment').replace(/[\r\n"]/g, '')
  const mimeType = p.get('t') ?? 'application/octet-stream'
  if (!/^[0-9a-f]+$/i.test(messageId) || !attachmentId) {
    return NextResponse.json({ error: 'Invalid attachment' }, { status: 400 })
  }

  try {
    const res = await getGmailClient().users.messages.attachments.get({ userId: 'me', messageId, id: attachmentId })
    const data = res.data.data
    if (!data) return NextResponse.json({ error: 'Attachment is empty' }, { status: 404 })
    const bytes = Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

    const viewable = VIEWABLE.test(mimeType) && p.get('dl') !== '1'
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': viewable ? mimeType : 'application/octet-stream',
        'Content-Disposition': `${viewable ? 'inline' : 'attachment'}; filename="${filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'X-Content-Type-Options': 'nosniff',
        // Chrome won't show a PDF in a sandboxed response; it has no script to run anyway
        ...(mimeType.toLowerCase() === 'application/pdf' ? {} : { 'Content-Security-Policy': 'sandbox' }),
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (err) {
    console.error('[mail] attachment fetch failed:', err)
    return NextResponse.json({ error: 'Could not load attachment' }, { status: 502 })
  }
}
