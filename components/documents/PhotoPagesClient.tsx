'use client'

import { useEffect, useState } from 'react'
import { PhotoPagesDocument, type PhotoPagesDocumentProps } from '@/components/documents/PhotoPagesDocument'
import { buildPhotoPages, type MeasuredPhoto } from '@/lib/documents/photo-layout'

// The photo pages on a browser print page. The layout needs each photo's
// shape, so the photos are loaded and measured here (orientation applied, as
// the browser shows them) — the same layout the PDFs make from photos
// measured in Chromium.

export interface PhotoPagesClientProps extends Pick<PhotoPagesDocumentProps, 'job' | 'variant' | 'reportRef'> {
  photos: { url: string; label: string | null }[]
}

function measure(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = url
  })
}

export function PhotoPagesClient({ photos, ...rest }: PhotoPagesClientProps) {
  const [measured, setMeasured] = useState<MeasuredPhoto[] | null>(null)
  const key = JSON.stringify(photos)

  useEffect(() => {
    let cancelled = false
    const list = JSON.parse(key) as PhotoPagesClientProps['photos']
    Promise.all(list.map(p => measure(p.url))).then(sizes => {
      if (cancelled) return
      setMeasured(list.map((p, i) => ({
        src: sizes[i] ? p.url : null,
        label: p.label,
        width: sizes[i]?.width,
        height: sizes[i]?.height,
      })))
    })
    return () => { cancelled = true }
  }, [key])

  if (photos.length === 0) return null
  if (!measured) {
    return (
      <div style={{ padding: '24px 16px', fontSize: '12px', color: '#9e998f', fontFamily: "'DM Sans', sans-serif" }}>
        Loading {photos.length} photo{photos.length === 1 ? '' : 's'}… (wait for them before printing)
      </div>
    )
  }
  const { photos: numbered, pages } = buildPhotoPages(measured)
  return <PhotoPagesDocument {...rest} photos={numbered} pages={pages} />
}
