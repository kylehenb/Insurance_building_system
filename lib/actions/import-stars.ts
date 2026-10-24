import type { SupabaseClient } from '@supabase/supabase-js'
import { searchFolder } from '@/lib/mail/list'
import { mailDb, type Mailbox } from '@/lib/mail/sync'
import { cardsForThreads, starThread } from './cards'

// Brings the stars from Gmail onto IRC's list, once, when moving over: each
// conversation starred in Gmail becomes a star the user set, as Everything
// else (Gmail doesn't say which star symbol it had) — the AI then reads it.
// Conversations already on the list are left as they are. Gmail's own stars
// aren't changed.

/** Enough for anyone's starred list; more is left for a second run */
const MAX_IMPORT = 300

export async function importGmailStars(
  mailbox: Mailbox,
  userId: string,
  db: SupabaseClient = mailDb(),
): Promise<{ found: number; added: number }> {
  const ids: string[] = []
  let cursor: string | null = null
  do {
    // Gmail search, so starred mail older than the mirror is fetched into it too
    const page = await searchFolder(mailbox, 'all', null, 'is:starred', cursor, db)
    ids.push(...page.threads.map(t => t.id).filter(id => !ids.includes(id)))
    cursor = page.cursor
  } while (cursor && ids.length < MAX_IMPORT)

  const already = await cardsForThreads(db, mailbox.tenant_id, ids)
  let added = 0
  for (const id of ids.slice(0, MAX_IMPORT)) {
    if (already[id]) continue
    await starThread(db, mailbox.tenant_id, id, 'other', userId)
    added++
  }
  return { found: ids.length, added }
}
