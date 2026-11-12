import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { sessionUser, unauthorized } from '@/lib/auth/session'
import { ATTACHMENT_BUCKET } from '@/lib/mail/compose'
import { MAX_EMAIL_BYTES } from '@/lib/mail/compose-rules'
import { mailDb } from '@/lib/mail/sync'

// POST /api/email-attachments/uploads { filename, size } — somewhere to upload
// a file from the computer being added to a document or work order email:
// returns { path, token } for storage.uploadToSignedUrl. The send names the
// path; lib/email/extra-files.ts reads it from there.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await sessionUser()
  if (!user) return unauthorized()

  let body: { filename?: unknown; size?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const filename = typeof body.filename === 'string' ? body.filename.replace(/[/\\\r\n"]/g, '_').trim().slice(0, 200) : ''
  const size = typeof body.size === 'number' ? body.size : 0
  if (!filename) return NextResponse.json({ error: 'filename is required' }, { status: 400 })
  if (size > MAX_EMAIL_BYTES) return NextResponse.json({ error: 'Files over 25 MB can\'t be emailed' }, { status: 413 })

  const path = `${user.tenantId}/${randomUUID()}/${filename}`
  const { data, error } = await mailDb().storage.from(ATTACHMENT_BUCKET).createSignedUploadUrl(path)
  if (error || !data) {
    console.error('[email-attachments] upload url failed:', error)
    return NextResponse.json({ error: 'Could not start the upload' }, { status: 502 })
  }
  return NextResponse.json({ path, token: data.token })
}
