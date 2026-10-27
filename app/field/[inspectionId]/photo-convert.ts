// Convert any image (including HEIC) to a compressed JPEG ≤ TARGET_BYTES, plus
// an optional small preview for the photo grid. Uses the canvas API — iOS
// Safari decodes HEIC natively, so no extra library needed. Canvases are
// emptied straight after use: iOS keeps their memory otherwise, and that (with
// dozens of full-size previews) is what crashed Safari on big photo sets.

const TARGET_BYTES = 125 * 1024 // 125 KB ceiling
const MAX_DIM = 1600 // 1600px max on longest side
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

export async function processPhoto(file: File, { thumb = false } = {}): Promise<{ file: File; thumb: Blob | null }> {
  const img = await loadImage(file)
  if (!img) return { file, thumb: null }

  const canvas = draw(img, MAX_DIM)
  // Adaptive quality — steps down until ≤ TARGET_BYTES or hits 0.55 floor
  let quality = 0.82
  let blob = await toBlob(canvas, quality)
  while (blob && blob.size > TARGET_BYTES && quality > 0.55) {
    quality = Math.round((quality - 0.08) * 100) / 100
    blob = await toBlob(canvas, quality)
  }
  release(canvas)

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
