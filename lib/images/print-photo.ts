import sharp from 'sharp'

// Photos as they go into a PDF (photo pages, report photos, the photos PDF
// sent with a work order). The PDF carries each photo as it's given, so its
// size is the sum of its photos: 96 field app photos at ~320 KB each made a
// 32 MB photos PDF that Gmail wouldn't send.
//
// No document prints a photo larger than about 9 × 12 cm (two to a row on
// the photo pages, lib/documents/photo-layout.ts), so 800 px on the long edge
// is 170–230 dots per inch on paper and still sharp zoomed in on screen.
// mozjpeg at quality 60 brings a typical site photo to 60–90 KB: about 8 MB
// for 100 photos. The same size the Midcity reports print photos at
// (app/midcity/field/[inspectionId]/print-images.tsx).

export const PRINT_PHOTO_MAX_EDGE = 800
export const PRINT_PHOTO_QUALITY = 60

export interface PrintPhoto {
  data: Buffer
  width: number
  height: number
}

/** The photo upright, no larger than PRINT_PHOTO_MAX_EDGE, as a small JPEG. Throws if it can't be read. */
export async function shrinkPhotoForPrint(input: Buffer): Promise<PrintPhoto> {
  const { data, info } = await sharp(input, { failOn: 'none' })
    .rotate()
    .resize({ width: PRINT_PHOTO_MAX_EDGE, height: PRINT_PHOTO_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: PRINT_PHOTO_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}
