// Preliminaries (insurance, levies, council fees) are priced from the rest of
// the quote: each has a formula of the subtotal of every other item. Shared by
// the quote editor (useQuote) and server-side edits (lib/quotes/service.ts) so
// both price them the same.

export const PRELIMINARIES_ROOM = 'Preliminaries'

/** The rate for a preliminary formula at this subtotal, or null for an unknown formula. */
export function preliminaryRate(formula: string, subtotal: number): number | null {
  let rate: number
  switch (formula) {
    case 'hii':
      rate = Math.max(700, subtotal * 0.012)
      break
    case 'ctf':
      rate = subtotal * 0.002
      break
    case 'bsl':
      rate = subtotal <= 45000 ? 61.65 : subtotal * 0.00137
      break
    case 'council':
      rate = Math.max(110, subtotal * 0.0019)
      break
    case 'cdc':
      rate = Math.max(1050, subtotal * 0.00165)
      break
    default:
      return null
  }
  return Math.round(rate * 100) / 100
}

export const isPreliminary = (item: { preliminary_formula: string | null; room: string | null }) =>
  !!item.preliminary_formula && item.room === PRELIMINARIES_ROOM
