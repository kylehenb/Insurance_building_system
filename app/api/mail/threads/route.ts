import { NextRequest, NextResponse, after } from 'next/server'
import { mailAccess } from '@/lib/mail/access'
import { isFolderKey } from '@/lib/mail/folders'
import { folderCounts, listFolder, searchFolder } from '@/lib/mail/list'
import { getMailbox, syncMailbox } from '@/lib/mail/sync'

export const maxDuration = 60

// A sync newer than this is fresh enough; older and opening the page kicks one off
const FRESH_MS = 30_000

// GET /api/mail/threads?folder=inbox&q=&cursor=
//   folder  inbox | sent | drafts | all | spam | trash (default inbox)
//   q       Gmail search syntax; searches Gmail instead of the mirror
//   cursor  from the previous page
export async function GET(req: NextRequest): Promise<NextResponse> {
  const access = await mailAccess()
  if (access instanceof NextResponse) return access

  const params = req.nextUrl.searchParams
  const folder = params.get('folder') ?? 'inbox'
  if (!isFolderKey(folder)) {
    return NextResponse.json({ error: 'Unknown folder' }, { status: 400 })
  }
  const q = params.get('q')?.trim() || null
  const cursor = params.get('cursor') || null

  try {
    const mailbox = await getMailbox(access.tenantId)

    const [page, counts] = await Promise.all([
      q ? searchFolder(mailbox, folder, q, cursor) : listFolder(mailbox, folder, cursor),
      folderCounts(mailbox),
    ])

    const stale = !mailbox.synced_at || Date.now() - new Date(mailbox.synced_at).getTime() > FRESH_MS
    if (stale) {
      after(async () => {
        await syncMailbox(mailbox, { budgetMs: 45_000 })
      })
    }

    return NextResponse.json({
      ...page,
      counts,
      mailbox: {
        email: mailbox.email_address,
        synced_at: mailbox.synced_at,
        sync_error: mailbox.sync_error,
        // The first sync is still filling folders
        backfilling: !mailbox.backfilled_at || !mailbox.synced_at,
      },
    })
  } catch (err) {
    console.error('[mail] list failed:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not load mail' }, { status: 502 })
  }
}
