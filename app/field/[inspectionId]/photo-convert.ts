// Convert any image (including HEIC) to a compressed JPEG ≤ TARGET_BYTES, plus
// an optional small preview for the photo grid. Uses the canvas API — iOS
// Safari decodes HEIC natively, so no extra library needed. Canvases are
// emptied straight after use: iOS keeps their memory otherwise, and that (with
// dozens of full-size previews) is what crashed Safari on big photo sets.
//
// Detailed site photos (roof tiles, gravel, foliage) don't reach the target at
// 1600 px without going blocky: they used to stop at the quality floor around
// 320 KB. Now a photo still over the target at 1600 px is drawn at 1280 px and
// stepped down again, which looks almost the same at about a third fewer bytes
// than 1600 px at the same quality. 1280 px is still well above what documents
// print at (800 px, lib/images/print-photo.ts) and the Midcity roof overview
// (1600 px across a page, so ~180 dpi from 1280).

const TARGET_BYTES = 125 * 1024 // 125 KB ceiling
/**
 * Longest side and the qualities tried at it, best first. 1600 px stops at
 * 0.66: below that, 1280 px looks better for the same bytes. 0.5 is the floor.
 * At most six encodes, so a big set still uploads quickly on a phone.
 */
const STEPS: { size: number; qualities: number[] }[] = [
  { size: 1600, qualities: [0.82, 0.74, 0.66] },
  { size: 1280, qualities: [0.66, 0.58, 0.5] },
]
const THUMB_DIM = 360

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
}

function release(canvas: HTMLCanvasElement) {
  canvas.width = 0
  canvas.height = 0
}

function draw(img: HTMLImageElement, maxDim: number): HTMLCanvasElement {
  let w = img.naturalWidth
  let h = img.naturalHeight
  if (w > maxDim || h > maxDim) {
    const scale = Math.min(maxDim / w, maxDim / h)
    w = Math.round(w * scale)
    h = Math.round(h * scale)
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
  return canvas
}

function loadImage(file: File): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    // Browser can't decode (e.g. Chrome with HEIC and no native support): the raw file is
    // sent instead, so the user sees an upload error rather than a silent hang. Never hit on iOS Safari.
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.src = url
  })
}

/** The smallest acceptable JPEG: the first size and quality at or under the target, or the smallest size at the floor */
async function encode(img: HTMLImageElement): Promise<Blob | null> {
  let blob: Blob | null = null
  for (const { size, qualities } of STEPS) {
    const canvas = draw(img, size)
    try {
      for (const quality of qualities) {
        blob = await toBlob(canvas, quality)
        if (!blob || blob.size <= TARGET_BYTES) return blob
      }
    } finally {
      release(canvas)
    }
  }
  return blob
}

export async function processPhoto(file: File, { thumb = false } = {}): Promise<{ file: File; thumb: Blob | null }> {
  const img = await loadImage(file)
  if (!img) return { file, thumb: null }

  const blob = await encode(img)

  let small: Blob | null = null
  if (thumb) {
    const t = draw(img, THUMB_DIM)
    small = await toBlob(t, 0.7)
    release(t)
  }
  img.src = ''

  if (!blob) return { file, thumb: small }
  const baseName = file.name.replace(/\.(heic|heif)$/i, '')
  const jpegName = baseName.match(/\.(jpe?g)$/i) ? file.name : `${baseName}.jpg`
  return { file: new File([blob], jpegName, { type: 'image/jpeg', lastModified: Date.now() }), thumb: small }
}

export async function processPhotoForUpload(file: File): Promise<File> {
  return (await processPhoto(file)).file
}
