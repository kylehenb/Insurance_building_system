import { loadPhotoImages } from '@/lib/documents/render-print-document'
import { buildPhotoPages } from '@/lib/documents/photo-layout'

// Photo pages for a PDF: downloads the photos, shrinks and measures them in
// Chromium (orientation applied), then lays them out (lib/documents/photo-layout.ts).

export async function preparePhotoPages(photos: { storage_path: string; label: string | null }[]) {
  const images = await loadPhotoImages(photos.map(p => p.storage_path))
  return buildPhotoPages(photos.map((p, i) => ({
    src: images[i]?.src ?? null,
    label: p.label,
    width: images[i]?.width,
    height: images[i]?.height,
  })))
}
