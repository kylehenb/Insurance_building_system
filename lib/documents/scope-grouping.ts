import type { Database } from '@/lib/supabase/database.types'

type Quote = Database['public']['Tables']['quotes']['Row']
type ScopeItem = Database['public']['Tables']['scope_items']['Row']

/**
 * Groups scope items by room for one or more quotes, merging each quote's
 * saved room_order in the order the quotes are given (falls back to
 * first-appearance order when no quote has a saved room_order — matches the
 * quote editor's own fallback, do NOT alphabetize).
 */
export function groupScopeItemsAcrossQuotes(quotes: Quote[], scopeItems: ScopeItem[]) {
  const items = [...scopeItems].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  const groupedByRoom = items.reduce((acc, item) => {
    const room = item.room || 'Unassigned'
    if (!acc[room]) acc[room] = []
    acc[room].push(item)
    return acc
  }, {} as Record<string, ScopeItem[]>)

  const combinedRoomOrder: string[] = []
  for (const quote of quotes) {
    for (const room of quote.room_order ?? []) {
      if (!combinedRoomOrder.includes(room)) combinedRoomOrder.push(room)
    }
  }

  const sortedRooms = (() => {
    const roomNames = Object.keys(groupedByRoom)
    if (combinedRoomOrder.length > 0) {
      const orderMap = new Map(combinedRoomOrder.map((r, i) => [r, i]))
      return roomNames.sort((a, b) => {
        const aIdx = orderMap.get(a) ?? 999
        const bIdx = orderMap.get(b) ?? 999
        return aIdx - bIdx
      })
    }
    return roomNames
  })()

  const quoteRefById = new Map(quotes.map(q => [q.id, q.quote_ref]))

  return { groupedByRoom, sortedRooms, quoteRefById }
}

/** "IRC1055-Q01" for a single quote, "IRC1055-Q01, IRC1055-Q02" for several. */
export function combinedQuoteRefLabel(quotes: Quote[]): string {
  return quotes.map(q => q.quote_ref).filter(Boolean).join(', ')
}
