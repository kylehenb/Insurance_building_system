import { describe, it, expect } from 'vitest'
import { bundleCards, todayBundles } from '../bundles'

// A job's cards bundle together where its most urgent card is; cards on no
// job stand alone; Today shows the first bundles and says how many more.

const c = (id: string, job_id: string | null) => ({ id, job_id })

describe('bundleCards', () => {
  it("keeps the list's order, bundling a job's cards where its first card is", () => {
    const out = bundleCards([c('a', 'j1'), c('b', null), c('c', 'j2'), c('d', 'j1'), c('e', 'j1')])
    expect(out.map(b => [b.key, b.cards.map(x => x.id)])).toEqual([
      ['job:j1', ['a', 'd', 'e']],
      ['b', ['b']],
      ['job:j2', ['c']],
    ])
  })
})

describe('todayBundles', () => {
  it('shows the first bundles and counts the rest', () => {
    const cards = Array.from({ length: 20 }, (_, i) => c(`k${i}`, i < 4 ? 'j1' : null))
    const { shown, more } = todayBundles(cards, 15)
    expect(shown).toHaveLength(15)
    expect(shown[0].cards).toHaveLength(4)
    expect(more).toBe(2)
  })
})
