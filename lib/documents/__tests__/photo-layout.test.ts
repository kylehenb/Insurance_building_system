import { describe, it, expect } from 'vitest'
import { layoutPhotoPages, placeLabel, PHOTO_PAGE_GEOMETRY, MIN_PHOTOS_PER_PAGE } from '../photo-layout'

const { width: W, height: H, gap: GAP } = PHOTO_PAGE_GEOMETRY
const PORTRAIT = 3 / 4
const LANDSCAPE = 4 / 3
const photo = (aspect: number, label: string | null = 'Kitchen ceiling') => ({ aspect, label })
const LONG = 'Ensuite – moisture reading at skirting near entry 45%, elevated – water tracking from shower recess under the floor tiles'

function rowsOf(page: ReturnType<typeof layoutPhotoPages>[number]) {
  const rows = new Map<number, typeof page>()
  for (const b of page) rows.set(b.y, [...(rows.get(b.y) ?? []), b])
  return [...rows.values()]
}

describe('layoutPhotoPages', () => {
  const mixed = [PORTRAIT, PORTRAIT, LANDSCAPE, LANDSCAPE, PORTRAIT, LANDSCAPE, 1, PORTRAIT, LANDSCAPE, PORTRAIT, PORTRAIT]
  const pages = layoutPhotoPages(mixed.map(a => photo(a)))
  const boxes = pages.flat()

  it('places every photo once, in order', () => {
    expect(boxes.map(b => b.index)).toEqual(mixed.map((_, i) => i))
  })

  it('never crops: every frame has its photo’s shape', () => {
    for (const b of boxes) expect(b.w / b.h).toBeCloseTo(mixed[b.index], 6)
  })

  it('fills the full width on every row of two, whatever the shapes', () => {
    for (const page of pages) {
      for (const row of rowsOf(page).filter(r => r.length === 2)) {
        expect(row[0].x).toBeCloseTo(0, 6)
        expect(row[1].x + row[1].w).toBeCloseTo(W, 6)
        expect(row[0].h).toBeCloseTo(row[1].h, 6)
      }
    }
  })

  it('keeps everything on the page and puts at least four photos on every page but the last', () => {
    for (const b of boxes) expect(b.y + b.h + b.belowHeight).toBeLessThanOrEqual(H + 0.001)
    pages.slice(0, -1).forEach(p => expect(p.length).toBeGreaterThanOrEqual(MIN_PHOTOS_PER_PAGE))
  })

  it('fits four portraits on a page at full width', () => {
    const p = layoutPhotoPages(Array.from({ length: 8 }, () => photo(PORTRAIT)))
    expect(p.map(x => x.length)).toEqual([4, 4])
    expect(p[0][1].x + p[0][1].w).toBeCloseTo(W, 6)
  })

  it('fits six landscapes on a page', () => {
    expect(layoutPhotoPages(Array.from({ length: 6 }, () => photo(LANDSCAPE))).map(x => x.length)).toEqual([6])
  })

  it('caps very tall photos so two rows still fit (narrower, centred row)', () => {
    const p = layoutPhotoPages([photo(9 / 16 / 2), photo(9 / 16 / 2), photo(PORTRAIT), photo(PORTRAIT)])
    expect(p).toHaveLength(1)
    const [a, b] = p[0]
    expect(a.h).toBeCloseTo((H - GAP) / 2, 6)
    expect(a.x).toBeGreaterThan(0)
    expect(W - (b.x + b.w)).toBeCloseTo(a.x, 6)
  })

  it('shrinks a row rather than leave a page with fewer than four photos', () => {
    const p = layoutPhotoPages([photo(PORTRAIT, LONG), photo(PORTRAIT, LONG), photo(PORTRAIT, LONG), photo(PORTRAIT, LONG)])
    expect(p).toHaveLength(1)
    for (const b of p[0]) expect(b.y + b.h + b.belowHeight).toBeLessThanOrEqual(H + 0.001)
  })

  it('puts an odd last photo on its own at half width, on the left', () => {
    const p = layoutPhotoPages([photo(PORTRAIT), photo(PORTRAIT), photo(LANDSCAPE)])
    const last = p[0][2]
    expect(last.x).toBe(0)
    expect(last.w).toBeCloseTo((W - GAP) / 2, 6)
  })

  it('treats a photo with no known size as 4:3', () => {
    const [b] = layoutPhotoPages([photo(NaN)])[0]
    expect(b.w / b.h).toBeCloseTo(4 / 3, 6)
  })
})

describe('placeLabel', () => {
  it('puts short labels on the photo and long ones in a pill below it', () => {
    expect(placeLabel('Front of property', 337)).toEqual({ labelPlacement: 'on', belowHeight: 0 })
    const below = placeLabel(LONG, 337)
    expect(below.labelPlacement).toBe('below')
    expect(below.belowHeight).toBeGreaterThan(20)
    expect(placeLabel('  ', 337)).toEqual({ labelPlacement: 'none', belowHeight: 0 })
    expect(placeLabel(null, 337).labelPlacement).toBe('none')
  })
})
