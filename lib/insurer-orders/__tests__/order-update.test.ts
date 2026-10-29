import { describe, it, expect } from 'vitest'
import { newOrderLines } from '../order-update'

// What's new in an order email on a claim that already has an order, compared
// with the original order email — for that conversation's action card.

describe('newOrderLines', () => {
  const original = 'New Quote/Report Request\nClaim:  CHCCLM010001723\nInsured: Charlie and Nina Ball\nDescription: Water damage to lounge'

  it('keeps only the lines the original order didn\'t have, ignoring spacing and case', () => {
    const update = 'NEW QUOTE/REPORT REQUEST\nClaim: CHCCLM010001723\nInsured: Charlie and Nina Ball\nDescription: Water damage to lounge\nPlease allocate an electrician to check the AV equipment.'
    expect(newOrderLines(original, update)).toEqual(['Please allocate an electrician to check the AV equipment.'])
  })

  it('leaves out quoted history and repeated lines', () => {
    const update = 'Extra trade: electrician\nExtra trade: electrician\n> Old quoted line\nOn Mon, 6 Oct 2026 at 11:45, Castle wrote:\nNot new either'
    expect(newOrderLines(original, update)).toEqual(['Extra trade: electrician'])
  })

  it('finds nothing in a straight re-send', () => {
    expect(newOrderLines(original, original)).toEqual([])
  })
})
