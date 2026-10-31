import Fuse, { type Expression } from 'fuse.js'

// Fuzzy search over scope library items, shared by the quote editor's
// description search and the field app's scope item search. Every word typed
// has to (fuzzily) match the description, keyword or trade, in any order —
// "ceiling paint" finds "Prepare and paint ceiling…", "downlight rr" finds
// keyword "downlightrr".
//
// Order: items where every word typed is a whole word or the start of one
// ("cei" → "ceiling") come first — those named by the words (in their
// keyword), then those with more whole words, then the items used on the most
// quotes, so typing "ceiling" offers the everyday ceiling items before "paint
// wardrobe ceiling". Usage only orders those good matches: a popular item
// never jumps ahead for a word it doesn't contain. Fuzzy (typo) matches
// follow, as before.

export interface SearchableScopeItem {
  item_description: string | null
  keyword: string | null
  trade: string | null
  insurer_specific?: string | null
  /** Quotes this item has been used on */
  uses?: number | null
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

const squash = (s: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

export function createScopeSearch<T extends SearchableScopeItem>(items: T[]) {
  const fuse = new Fuse(items, FUSE_OPTIONS)
  return (query: string, limit = 8): T[] => {
    const words = query.toLowerCase().split(/[\s,/]+/).map(w => w.trim()).filter(w => w.length >= 2).slice(0, 8)
    if (!words.length) return []
    const expression: Expression = {
      $and: words.map((w): Expression => ({ $or: ['item_description', 'keyword', 'trade'].map((key): Expression => ({ [key]: w })) })),
    }
    const scored = fuse.search(expression).map(({ item, score = 0 }) => {
      const spaced = (...parts: (string | null)[]) => ` ${parts.join(' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
      const text = spaced(item.item_description, item.keyword, item.trade)
      // What the item is (not its trade): every "Ceiling Fixer" item isn't a ceiling item
      const own = spaced(item.item_description, item.keyword)
      return {
        item,
        // Whole words count for more than parts of words: "ceiling paint" is the painting item, not "…ready for painting"
        rank: score - 0.05 * words.filter(w => text.includes(` ${w} `)).length,
        strong: words.every(w => own.includes(` ${w}`)),
        wholeWords: words.filter(w => [' ', 's ', 'es '].some(end => own.includes(` ${w}${end}`))).length,
        // Named by its keyword ("paintCeiling", "doorinternal"), not just mentioned in passing ("…re-use doors")
        named: words.filter(w => squash(item.keyword).includes(w)).length,
        uses: item.uses ?? 0,
      }
    })
    return scored
      .sort((a, b) => {
        if (a.strong !== b.strong) return a.strong ? -1 : 1
        if (a.strong && a.named !== b.named) return b.named - a.named
        if (a.strong && a.wholeWords !== b.wholeWords) return b.wholeWords - a.wholeWords
        if (a.strong && a.uses !== b.uses) return b.uses - a.uses
        // Close ranks: the insurer's own item first
        const diff = a.rank - b.rank
        if (Math.abs(diff) > 0.02) return diff
        return (a.item.insurer_specific ? 0 : 1) - (b.item.insurer_specific ? 0 : 1)
      })
      .slice(0, limit)
      .map(r => r.item)
  }
}

export interface ScopeUsageRow {
  scope_library_id: string
  keyword: string | null
  uses: number
}

/**
 * Quotes each catalogue item has been used on, for ordering the search. An
 * item also gets the uses of library rows with the same keyword that the job
 * doesn't offer (the standard row an insurer's own row replaces, another
 * insurer's row, an archived one), so an insurer's own item isn't left at 0.
 */
export function usesByItem(catalogue: { id: string; keyword: string | null }[], usage: ScopeUsageRow[]): Map<string, number> {
  const offered = new Set(catalogue.map(i => i.id))
  const own = new Map<string, number>()
  const elsewhere = new Map<string, number>()
  for (const u of usage) {
    const uses = Number(u.uses) || 0
    own.set(u.scope_library_id, (own.get(u.scope_library_id) ?? 0) + uses)
    const key = squash(u.keyword)
    if (key && !offered.has(u.scope_library_id)) elsewhere.set(key, (elsewhere.get(key) ?? 0) + uses)
  }
  return new Map(catalogue.map(i => [i.id, (own.get(i.id) ?? 0) + (elsewhere.get(squash(i.keyword)) ?? 0)]))
}
