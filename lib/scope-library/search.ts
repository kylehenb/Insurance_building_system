import Fuse, { type Expression } from 'fuse.js'

// Fuzzy search over scope library items, shared by the quote editor's
// description search and the field app's scope item search. Every word typed
// has to (fuzzily) match the description, keyword or trade, in any order —
// "ceiling paint" finds "Prepare and paint ceiling…", "downlight rr" finds
// keyword "downlightrr".

export interface SearchableScopeItem {
  item_description: string | null
  keyword: string | null
  trade: string | null
  insurer_specific?: string | null
}

const FUSE_OPTIONS = {
  keys: [
    { name: 'item_description', weight: 3 },
    { name: 'keyword', weight: 2 },
    { name: 'trade', weight: 1 },
  ],
  threshold: 0.3,
  includeScore: true,
  ignoreLocation: true,
  minMatchCharLength: 2,
}

export function createScopeSearch<T extends SearchableScopeItem>(items: T[]) {
  const fuse = new Fuse(items, FUSE_OPTIONS)
  return (query: string, limit = 8): T[] => {
    const words = query.toLowerCase().split(/[\s,/]+/).map(w => w.trim()).filter(w => w.length >= 2).slice(0, 8)
    if (!words.length) return []
    const expression: Expression = {
      $and: words.map((w): Expression => ({ $or: ['item_description', 'keyword', 'trade'].map((key): Expression => ({ [key]: w })) })),
    }
    // Whole words count for more than parts of words: "ceiling paint" is the painting item, not "…ready for painting"
    const rank = (item: T, score = 0) => {
      const text = ` ${[item.item_description, item.keyword, item.trade].join(' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
      return score - 0.05 * words.filter(w => text.includes(` ${w} `)).length
    }
    return fuse.search(expression, { limit: limit * 3 })
      .map(r => ({ item: r.item, rank: rank(r.item, r.score) }))
      // Close ranks: the insurer's own item first
      .sort((a, b) => {
        const diff = a.rank - b.rank
        if (Math.abs(diff) > 0.02) return diff
        return (a.item.insurer_specific ? 0 : 1) - (b.item.insurer_specific ? 0 : 1)
      })
      .slice(0, limit)
      .map(r => r.item)
  }
}
