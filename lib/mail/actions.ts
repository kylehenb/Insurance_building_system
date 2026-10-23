import { getGmailClient } from '@/lib/gmail/client'
import { actionLabelChanges, type MailAction } from './folders'
import { fetchThreads, mailDb, type Mailbox } from './sync'

// Archive, bin, spam, read/unread — done in Gmail, then the mirror is
// refreshed from what Gmail now says, so the app and the Gmail app agree.

export const MAX_THREADS_PER_ACTION = 100

const CONCURRENCY = 8

export type ActionResult = { done: string[]; failed: string[] }

export async function applyThreadAction(mailbox: Mailbox, threadIds: string[], action: MailAction, db = mailDb()): Promise<ActionResult> {
  const gmail = getGmailClient()
  const { add, remove } = actionLabelChanges(action)

  // Moving out of the Bin needs untrash; labels alone don't do it
  let inBin = new Set<string>()
  if (action === 'inbox') {
    const { data } = await db
      .from('mail_threads')
      .select('gmail_thread_id')
      .eq('mailbox_id', mailbox.id)
      .in('gmail_thread_id', threadIds)
      .contains('label_ids', ['TRASH'])
    inBin = new Set(((data as { gmail_thread_id: string }[] | null) ?? []).map(r => r.gmail_thread_id))
  }

  const done: string[] = []
  const failed: string[] = []
  let next = 0

  async function apply(id: string) {
    if (action === 'trash') {
      await gmail.users.threads.trash({ userId: 'me', id })
      return
    }
    if (action === 'untrash' || inBin.has(id)) {
      await gmail.users.threads.untrash({ userId: 'me', id })
    }
    const addLabelIds = add.filter(l => l !== 'TRASH')
    const removeLabelIds = remove.filter(l => l !== 'TRASH')
    if (addLabelIds.length || removeLabelIds.length) {
      await gmail.users.threads.modify({ userId: 'me', id, requestBody: { addLabelIds, removeLabelIds } })
    }
  }

  async function worker() {
    while (next < threadIds.length) {
      const id = threadIds[next++]
      try {
        await apply(id)
        done.push(id)
      } catch (err) {
        console.error(`[mail] ${action} failed for thread ${id}:`, err)
        failed.push(id)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, threadIds.length) }, worker))

  if (done.length) await fetchThreads(mailbox, done, db)
  return { done, failed }
}
