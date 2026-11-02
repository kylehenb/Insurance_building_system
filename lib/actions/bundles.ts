// Bundles (tech spec §23.11): on the list, a job's cards sit together as one
// bundle ("IRC1055 — 3 to do"), each card still done or skipped on its own.
// Cards on no job stand alone. A bundle takes the place of its most urgent
// card, so the list keeps its order (most urgent first).

/** Today shows this many bundles and lone cards; the rest are a click away */
export const TODAY_CAP = 15

export type Bundle<T> = { key: string; jobId: string | null; cards: T[] }

export function bundleCards<T extends { id: string; job_id: string | null }>(cards: T[]): Bundle<T>[] {
  const out: Bundle<T>[] = []
  const byJob = new Map<string, Bundle<T>>()
  for (const card of cards) {
    if (!card.job_id) {
      out.push({ key: card.id, jobId: null, cards: [card] })
      continue
    }
    const existing = byJob.get(card.job_id)
    if (existing) existing.cards.push(card)
    else {
      const bundle = { key: `job:${card.job_id}`, jobId: card.job_id, cards: [card] }
      byJob.set(card.job_id, bundle)
      out.push(bundle)
    }
  }
  return out
}

/** Today: the first TODAY_CAP bundles, and how many more there are */
export function todayBundles<T extends { id: string; job_id: string | null }>(cards: T[], cap = TODAY_CAP): { shown: Bundle<T>[]; more: number } {
  const all = bundleCards(cards)
  return { shown: all.slice(0, cap), more: Math.max(0, all.length - cap) }
}
