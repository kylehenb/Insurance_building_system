import { NextResponse } from 'next/server'
import { cardAccess } from '@/lib/actions/access'
import { importGmailStars } from '@/lib/actions/import-stars'
import { recordActivity } from '@/lib/activity/log'
import { getMailbox } from '@/lib/mail/sync'

export const maxDuration = 300

// POST /api/actions/import-stars — the conversations starred in Gmail go on
// the list (as Everything else). Safe to run again: ones already on it stay.
export async function POST(): Promise<NextResponse> {
  const access = await cardAccess(true)
  if (access instanceof NextResponse) return access
  try {
    const result = await importGmailStars(await getMailbox(access.tenantId), access.userId)
    if (result.added) {
      await recordActivity({
        tenantId: access.tenantId,
        userId: access.userId,
        action: 'actions.review',
        summary: `Brought over ${result.added} starred email${result.added === 1 ? '' : 's'} from Gmail`,
        via: 'app',
      })
    }
    return NextResponse.json(result)
  } catch (err) {
    console.error('[actions] import stars failed:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not read the stars from Gmail' }, { status: 502 })
  }
}
