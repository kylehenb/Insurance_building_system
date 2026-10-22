// Photo pages layout: rows of two photos, each row scaled so both photos are
// the same height and together fill the page width exactly. Every frame has
// its photo's own shape, so nothing is cropped or letterboxed: portraits make
// tall rows, landscapes short ones, a mix shares the width in proportion.
//
//   - Row height is capped so two rows always fit on a page (at least four
//     photos a page; a very tall photo gets a narrower, centred row).
//   - If a row still won't fit (long labels under the photos) and the page has
//     fewer than four photos, the row shrinks to fit instead of moving on.
//   - An odd last photo sits on its own at half width, on the left.
//   - Labels go on the photo, in a pill, when they fit in two lines across
//     ~72% of the photo; longer ones go under it in the same pill.
//
// All sizes are CSS px of the photo area on an A4 page with 10mm margins.

export interface PhotoLayoutInput {
  /** width / height of the photo as displayed (orientation applied) */
  aspect: number
  label: string | null
}

export interface PhotoLayoutBox {
  /** Index into the input list */
  index: number
  x: number
  y: number
  w: number
  h: number
  /** 'on' = pill on the photo, 'below' = pill under it, 'none' = number only */
  labelPlacement: 'on' | 'below' | 'none'
  /** Height reserved under the photo for a 'below' label */
  belowHeight: number
}

export interface PhotoLayoutGeometry {
  width: number
  height: number
  gap: number
}

/** Photo area of one page (A4 less 10mm margins, page header and footer). */
export const PHOTO_PAGE_GEOMETRY: PhotoLayoutGeometry = { width: 686, height: 957, gap: 12 }

export const MIN_PHOTOS_PER_PAGE = 4
const FALLBACK_ASPECT = 4 / 3

// Label pill metrics (9.5px DM Sans 500): average character width, line
// height, padding, and the room the number chip takes.
const CHAR_W = 5.1
const LINE_H = 12.8
const PILL_PAD_Y = 6
const CHIP_W = 30
const ON_PHOTO_WIDTH = 0.72
const BELOW_GAP = 5

function labelLines(label: string, width: number): number {
  const perLine = Math.max(8, Math.floor((width - CHIP_W) / CHAR_W))
  // Words don't split: allow for the ragged end of each line
  return Math.ceil(label.length / (perLine * 0.9))
}

/** Where a label goes on a photo of width w, and the room it needs under it. */
export function placeLabel(label: string | null, w: number): Pick<PhotoLayoutBox, 'labelPlacement' | 'belowHeight'> {
  const text = label?.trim()
  if (!text) return { labelPlacement: 'none', belowHeight: 0 }
  if (labelLines(text, w * ON_PHOTO_WIDTH) <= 2) return { labelPlacement: 'on', belowHeight: 0 }
  return { labelPlacement: 'below', belowHeight: BELOW_GAP + PILL_PAD_Y + labelLines(text, w) * LINE_H }
}

function validAspect(a: number): number {
  return Number.isFinite(a) && a > 0 ? a : FALLBACK_ASPECT
}

/** Lays the photos out in order, page by page. */
export function layoutPhotoPages(
  photos: PhotoLayoutInput[],
  geometry: PhotoLayoutGeometry = PHOTO_PAGE_GEOMETRY,
): PhotoLayoutBox[][] {
  const { width: W, height: H, gap: GAP } = geometry
  const maxRowH = (H - GAP) / 2
  const halfW = (W - GAP) / 2

  const pages: PhotoLayoutBox[][] = []
  let page: PhotoLayoutBox[] = []
  let y = 0

  for (let i = 0; i < photos.length; i += 2) {
    const pair = photos.slice(i, i + 2).map((p, k) => ({ ...p, index: i + k, aspect: validAspect(p.aspect) }))

    // Height at which the row fills the width (a lone last photo: half width)
    const fullW = pair.length === 2 ? W - GAP : halfW
    const aspectSum = pair.reduce((s, p) => s + p.aspect, 0)
    let h = Math.min(fullW / aspectSum, maxRowH)

    const rowFor = (rowH: number) => {
      const ws = pair.map(p => p.aspect * rowH)
      const labels = pair.map((p, k) => placeLabel(p.label, ws[k]))
      const below = Math.max(...labels.map(l => l.belowHeight))
      return { ws, labels, need: rowH + below }
    }

    let row = rowFor(h)
    if (y + row.need > H && page.length > 0) {
      if (page.length < MIN_PHOTOS_PER_PAGE && H - y > maxRowH * 0.6) {
        // Shrink this row onto the page rather than leave it short of four
        // (a narrower photo can wrap its label onto more lines: repeat)
        for (let k = 0; k < 6 && y + row.need > H; k++) {
          h = h * (H - y) / row.need
          row = rowFor(h)
        }
      } else {
        pages.push(page)
        page = []
        y = 0
      }
    }

    const rowW = row.ws.reduce((s, w) => s + w, 0) + GAP * (pair.length - 1)
    let x = pair.length === 2 ? (W - rowW) / 2 : 0
    pair.forEach((p, k) => {
      page.push({ index: p.index, x, y, w: row.ws[k], h, ...row.labels[k] })
      x += row.ws[k] + GAP
    })
    y += row.need + GAP
  }
  if (page.length > 0) pages.push(page)
  return pages
}
