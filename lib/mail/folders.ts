// Mail client folders and the Gmail label behind each. Safe for client code.

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
