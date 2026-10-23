// Mail client folders, inbox tabs and conversation actions, and the Gmail
// labels behind each. Pure — safe for client code; the server applies the
// same rules (lib/mail/actions.ts) so the page can update before Gmail answers.

export const FOLDERS = [
  { key: 'inbox', label: 'Inbox', gmailLabel: 'INBOX' },
  { key: 'sent', label: 'Sent', gmailLabel: 'SENT' },
  { key: 'drafts', label: 'Drafts', gmailLabel: 'DRAFT' },
  { key: 'all', label: 'All mail', gmailLabel: null },
  { key: 'spam', label: 'Spam', gmailLabel: 'SPAM' },
  { key: 'trash', label: 'Bin', gmailLabel: 'TRASH' },
] as const

export type FolderKey = typeof FOLDERS[number]['key']

export function isFolderKey(value: unknown): value is FolderKey {
  return FOLDERS.some(f => f.key === value)
}

export function folderLabel(key: FolderKey): string | null {
  return FOLDERS.find(f => f.key === key)?.gmailLabel ?? null
}

/** Spam and Bin are left out of every folder but their own, as in Gmail */
export const HIDDEN_LABELS = ['SPAM', 'TRASH']

/** Lists that show who it went to rather than who it came from */
export const SHOWS_RECIPIENTS: FolderKey[] = ['sent', 'drafts']

// ── Inbox tabs ──
// Gmail's category tabs. Primary is everything the other tabs don't take
// (Updates and Forums aren't turned on for the office mailbox, so they stay in Primary).

export const TABS = [
  { key: 'primary', label: 'Primary', gmailLabel: null },
  { key: 'promotions', label: 'Promotions', gmailLabel: 'CATEGORY_PROMOTIONS' },
  { key: 'social', label: 'Social', gmailLabel: 'CATEGORY_SOCIAL' },
] as const

export type TabKey = typeof TABS[number]['key']

export function isTabKey(value: unknown): value is TabKey {
  return TABS.some(t => t.key === value)
}

export const TAB_LABELS: string[] = TABS.map(t => t.gmailLabel).filter((l): l is NonNullable<typeof l> => !!l)

export function tabLabel(key: TabKey): string | null {
  return TABS.find(t => t.key === key)?.gmailLabel ?? null
}

/** Whether a conversation with these labels shows in a folder (and inbox tab) */
export function inFolder(folder: FolderKey, labels: string[], tab: TabKey | null = null): boolean {
  const label = folderLabel(folder)
  if (label !== 'SPAM' && label !== 'TRASH' && labels.some(l => HIDDEN_LABELS.includes(l))) return false
  if (label && !labels.includes(label)) return false
  if (folder === 'inbox' && tab) {
    const t = tabLabel(tab)
    return t ? labels.includes(t) : !labels.some(l => TAB_LABELS.includes(l))
  }
  return true
}

// ── Actions ──

export const MAIL_ACTIONS = ['archive', 'inbox', 'trash', 'untrash', 'spam', 'not_spam', 'read', 'unread'] as const
export type MailAction = typeof MAIL_ACTIONS[number]

export function isMailAction(value: unknown): value is MailAction {
  return MAIL_ACTIONS.includes(value as MailAction)
}

export const ACTION_DONE: Record<MailAction, string> = {
  archive: 'archived',
  inbox: 'moved to Inbox',
  trash: 'moved to Bin',
  untrash: 'moved out of Bin',
  spam: 'marked as spam',
  not_spam: 'moved to Inbox',
  read: 'marked as read',
  unread: 'marked as unread',
}

/** Gmail labels added and removed by an action */
export function actionLabelChanges(action: MailAction): { add: string[]; remove: string[] } {
  switch (action) {
    case 'archive': return { add: [], remove: ['INBOX'] }
    case 'inbox': return { add: ['INBOX'], remove: ['SPAM', 'TRASH'] }
    case 'trash': return { add: ['TRASH'], remove: [] }
    case 'untrash': return { add: [], remove: ['TRASH'] }
    case 'spam': return { add: ['SPAM'], remove: ['INBOX'] }
    case 'not_spam': return { add: ['INBOX'], remove: ['SPAM'] }
    case 'read': return { add: [], remove: ['UNREAD'] }
    case 'unread': return { add: ['UNREAD'], remove: [] }
  }
}

/** A conversation's labels after an action */
export function applyAction(labels: string[], action: MailAction): string[] {
  const { add, remove } = actionLabelChanges(action)
  const next = new Set(labels.filter(l => !remove.includes(l)))
  for (const l of add) next.add(l)
  return [...next].sort()
}

/** The action that puts a conversation back the way it was before `action` */
export function undoAction(action: MailAction, before: string[]): MailAction {
  const had = (l: string) => before.includes(l)
  switch (action) {
    case 'archive': return 'inbox'
    case 'inbox':
    case 'not_spam':
      return had('TRASH') ? 'trash' : had('SPAM') ? 'spam' : 'archive'
    case 'trash': return had('INBOX') ? 'inbox' : 'untrash'
    case 'untrash': return 'trash'
    // Spam can only be undone back into the inbox — an archived conversation marked spam comes back to the inbox
    case 'spam': return 'not_spam'
    case 'read': return 'unread'
    case 'unread': return 'read'
  }
}
