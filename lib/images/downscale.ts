import sharp from 'sharp'

// Shrinking photos: for Claude to look at (get_job_photo) and to fit email
// attachments under Gmail's limit. Upright (EXIF rotation applied), longest
// edge capped, JPEG — keeps handwriting and dimensions on a floor plan
// legible at a fraction of a phone photo's size.

export const VIEW_MAX_EDGE = 1600
export const VIEW_QUALITY = 80
/** Photos compressed to fit an email stay a bit bigger than for viewing */
export const EMAIL_MAX_EDGE = 2048
export const EMAIL_QUALITY = 80

export interface DownscaledImage {
  data: Buffer
  mimeType: 'image/jpeg'
  width: number
  height: number
}

export class ImageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageError'
  }
}

/** The image as a JPEG no larger than maxEdge on its longest side (never enlarged). */
export async function downscaleImage(input: Buffer, maxEdge = VIEW_MAX_EDGE, quality = VIEW_QUALITY): Promise<DownscaledImage> {
  try {
    const { data, info } = await sharp(input, { failOn: 'none' })
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true })
    return { data, mimeType: 'image/jpeg', width: info.width, height: info.height }
  } catch (err) {
    throw new ImageError(`Couldn't open the image (${err instanceof Error ? err.message : 'unknown format'})`)
  }
}

/** A JPEG file name for a compressed copy: "IMG_1.HEIC" → "IMG_1.jpg" */
export function jpegName(filename: string): string {
  return /\.(jpe?g)$/i.test(filename) ? filename : `${filename.replace(/\.[a-z0-9]{2,5}$/i, '')}.jpg`
}
