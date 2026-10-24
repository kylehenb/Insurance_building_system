import { NextRequest, NextResponse, after } from 'next/server'
import { mailAccess } from '@/lib/mail/access'
import { isFolderKey, isTabKey } from '@/lib/mail/folders'
import { userLabels } from '@/lib/mail/labels'
import { isFiling } from '@/lib/mail/filing'
import { folderCounts, listFolder, searchFolder } from '@/lib/mail/list'
import { getMailbox, mailDb, syncMailbox } from '@/lib/mail/sync'
import { cardsForThreads, onMailArrivals } from '@/lib/actions/cards'
import { scheduledThreads } from '@/lib/mail/scheduled'

export const maxDuration = 60

// A sync newer than this is fresh enough; older and opening the page kicks one off
const FRESH_MS = 30_000

// GET /api/mail/threads?folder=inbox&tab=primary&q=&cursor=
//   folder  inbox | sent | drafts | all | spam | trash (default inbox)
//   tab     primary | promotions | social — inbox only
//   filing  job | to_file | admin — where it stands in IRC
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
  const tabParam = params.get('tab')
  const tab = folder === 'inbox' ? (isTabKey(tabParam) ? tabParam : 'primary') : null
  const filingParam = params.get('filing')
  const filing = isFiling(filingParam) ? filingParam : null
  const q = params.get('q')?.trim() || null
  const cursor = params.get('cursor') || null

  try {
    const mailbox = await getMailbox(access.tenantId)

    const [page, counts, labels, scheduled] = await Promise.all([
      q ? searchFolder(mailbox, folder, tab, q, cursor, undefined, filing) : listFolder(mailbox, folder, tab, cursor, undefined, filing),
      folderCounts(mailbox),
      // Chips are a nicety — the list still loads if Gmail's label list doesn't
      userLabels().catch(() => ({})),
      scheduledThreads(mailbox),
    ])

    // Each conversation's live action card, for the chip on its row
    const cards = await cardsForThreads(mailDb(), access.tenantId, page.threads.map(t => t.id)).catch(() => ({}))

    const stale = !mailbox.synced_at || Date.now() - new Date(mailbox.synced_at).getTime() > FRESH_MS
    if (stale) {
      after(async () => {
        const result = await syncMailbox(mailbox, { budgetMs: 45_000 })
        await onMailArrivals(mailDb(), mailbox.tenant_id, result.arrivals)
      })
    }

    return NextResponse.json({
      ...page,
      counts,
      labels,
      scheduled,
      cards,
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
