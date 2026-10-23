import { getGmailClient } from '@/lib/gmail/client'

// The mailbox's own Gmail labels ("Office", "Kyle", …) with their colours,
// for the chips in the conversation list. Cached — labels rarely change.

export type UserLabel = { name: string; textColor: string | null; backgroundColor: string | null }

const TTL_MS = 5 * 60_000
let cache: { labels: Record<string, UserLabel>; at: number } | null = null

export async function userLabels(): Promise<Record<string, UserLabel>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.labels
  const res = await getGmailClient().users.labels.list({ userId: 'me' })
  const labels: Record<string, UserLabel> = {}
  for (const l of res.data.labels ?? []) {
    if (l.type !== 'user' || !l.id || !l.name) continue
    labels[l.id] = {
      name: l.name,
      textColor: l.color?.textColor ?? null,
      backgroundColor: l.color?.backgroundColor ?? null,
    }
  }
  cache = { labels, at: Date.now() }
  return labels
}
