import { NextResponse } from 'next/server'
import { mailAccess } from '@/lib/mail/access'
import { folderCounts } from '@/lib/mail/list'
import { getMailbox } from '@/lib/mail/sync'

// GET /api/mail/counts — unread and to-file counts (the dashboard's "emails to file" card)
export async function GET(): Promise<NextResponse> {
  const access = await mailAccess()
  if (access instanceof NextResponse) return access
  try {
    return NextResponse.json(await folderCounts(await getMailbox(access.tenantId)))
  } catch (err) {
    console.error('[mail] counts failed:', err)
    return NextResponse.json({ error: 'Could not count mail' }, { status: 502 })
  }
}
