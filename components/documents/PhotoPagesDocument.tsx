import type { PhotosPrintData } from '@/lib/documents/print-data'
import { PHOTO_PAGE_GEOMETRY, type PhotoLayoutBox } from '@/lib/documents/photo-layout'

// Photo pages: rows fitted to each photo's shape, so nothing is cropped, with
// numbered labels in pills (lib/documents/photo-layout.ts). Used on their own
// (Photos PDF, photos sent with work orders, /print/jobs/[jobId]/photos) and
// as the photographs section of a report (variant 'report').
//
// The layout needs each photo's shape: the PDFs measure the photos in
// Chromium (lib/documents/photo-pages.ts), the print pages in the browser
// (PhotoPagesClient). Sized for A4 with 10mm margins.

export interface PhotoPagesPhoto {
  /** Shown in the number chip (1, 2, 3… in order) */
  number: number
  label: string | null
  /** data: URI; null when the photo couldn't be loaded */
  src: string | null
}

export interface PhotoPagesDocumentProps {
  job: PhotosPrintData['job']
  photos: PhotoPagesPhoto[]
  /** From layoutPhotoPages, indexes into photos */
  pages: PhotoLayoutBox[][]
  /**
   * 'photos' (default): job details header on every page.
   * 'report': a PHOTOGRAPHS header in the report's style; starts on a new
   * page, and the last page is only as tall as its photos so the report's
   * footer follows straight after.
   */
  variant?: 'photos' | 'report'
  /** Report variant: shown in the header, e.g. the report reference */
  reportRef?: string | null
}

const PAGE_H = 1045
const HEADER_H = 37
const PAD_Y = 14
const PAD_X = 16
const FOOTER_H = 22

const PILL: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '5px',
  background: 'rgba(26,26,26,0.72)',
  color: '#ffffff',
  borderRadius: '4px',
  padding: '3px 7px 3px 3px',
  fontSize: '9.5px',
  fontWeight: 500,
  lineHeight: 1.35,
}

const CHIP: React.CSSProperties = {
  background: '#c8b89a',
  color: '#1a1a1a',
  borderRadius: '3px',
  padding: '0 5px',
  fontWeight: 700,
  flexShrink: 0,
}

function contentHeight(boxes: PhotoLayoutBox[]): number {
  return Math.max(0, ...boxes.map(b => b.y + b.h + b.belowHeight))
}

export function PhotoPagesDocument({ job, photos, pages, variant = 'photos', reportRef }: PhotoPagesDocumentProps) {
  const isReport = variant === 'report'
  const headerFields = [
    { label: 'Job #', value: job.job_number },
    { label: 'Address', value: job.property_address },
    { label: 'Claim #', value: job.claim_number },
    { label: 'Insured', value: job.insured_name },
  ].filter((f): f is { label: string; value: string } => Boolean(f.value))

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", color: '#1a1a1a', background: 'white' }}>
      {pages.map((boxes, pageIndex) => {
        const last = pageIndex === pages.length - 1
        const height = isReport && last
          ? HEADER_H + PAD_Y + contentHeight(boxes) + PAD_Y + FOOTER_H
          : PAGE_H
        return (
        <div
          key={pageIndex}
          style={{
            position: 'relative',
            height: `${height}px`,
            overflow: 'hidden',
            flexShrink: 0,
            breakBefore: isReport && pageIndex === 0 ? 'page' : 'auto',
            breakAfter: last ? 'auto' : 'page',
            breakInside: 'avoid',
          }}
        >
          {isReport ? (
            // Report: section heading in the report's style
            <div style={{
              height: `${HEADER_H}px`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: `0 ${PAD_X}px`,
              borderBottom: '1px solid #e0dbd4',
              whiteSpace: 'nowrap',
            }}>
              <span style={{ fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#6a6460', fontWeight: 800 }}>
                Photographs{pageIndex > 0 ? ' (continued)' : ''}
              </span>
              <span style={{ fontSize: '10px', color: '#9e998f' }}>
                {[reportRef, job.job_number].filter(Boolean).join(' · ')}
              </span>
            </div>
          ) : (
          <div style={{
            height: `${HEADER_H}px`,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: `0 ${PAD_X}px`,
            borderBottom: '1px solid #e0dbd4',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-alt.png" alt="IRC" style={{ height: '22px', width: 'auto', flexShrink: 0 }} />
            <div style={{ width: '1px', height: '16px', background: '#e0dbd4', flexShrink: 0 }} />
            <div style={{ display: 'flex', alignItems: 'center', fontSize: '11px', lineHeight: '1.3', minWidth: 0 }}>
              {headerFields.map((f, i) => (
                <span
                  key={f.label}
                  style={{
                    paddingRight: i < headerFields.length - 1 ? '10px' : 0,
                    marginRight: i < headerFields.length - 1 ? '10px' : 0,
                    borderRight: i < headerFields.length - 1 ? '1px solid #e0dbd4' : 'none',
                    // A very long address gives way rather than wrapping onto the photos
                    ...(f.label === 'Address' ? { overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 } : { flexShrink: 0 }),
                  }}
                >
                  <span style={{ color: '#9e998f' }}>{f.label}: </span>
                  <span style={{ color: '#1a1a1a', fontWeight: 500 }}>{f.value}</span>
                </span>
              ))}
            </div>
          </div>
          )}

          {/* Photos */}
          <div style={{
            position: 'absolute',
            left: `${PAD_X}px`,
            top: `${HEADER_H + PAD_Y}px`,
            width: `${PHOTO_PAGE_GEOMETRY.width}px`,
            height: `${PHOTO_PAGE_GEOMETRY.height}px`,
          }}>
            {boxes.map(box => {
              const photo = photos[box.index]
              return (
                <div
                  key={box.index}
                  style={{ position: 'absolute', left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` }}
                >
                  {photo.src ? (
                    // contain, not cover: the frame already has the photo's shape,
                    // so this can never trim an edge
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photo.src}
                      alt={photo.label || `Photo ${photo.number}`}
                      style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', borderRadius: '4px' }}
                    />
                  ) : (
                    <div style={{
                      width: '100%', height: '100%', borderRadius: '4px', background: '#f5f2ee',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#9e998f',
                    }}>
                      Photo unavailable
                    </div>
                  )}
                  <div style={{ ...PILL, position: 'absolute', top: '6px', left: '6px', maxWidth: '72%' }}>
                    <span style={CHIP}>{photo.number}</span>
                    {box.labelPlacement === 'on' && <span>{photo.label}</span>}
                  </div>
                  {box.labelPlacement === 'below' && (
                    <div style={{ ...PILL, position: 'absolute', left: 0, top: `${box.h + 5}px`, maxWidth: `${box.w}px` }}>
                      <span style={CHIP}>{photo.number}</span>
                      <span>{photo.label}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Footer */}
          <div style={{
            position: 'absolute',
            left: `${PAD_X}px`,
            right: `${PAD_X}px`,
            bottom: 0,
            height: `${FOOTER_H}px`,
            borderTop: '1px dashed #d8d0c8',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '9px',
            color: '#9e998f',
          }}>
            <span>{isReport ? 'Photographs' : 'Photos'}</span>
            <span>Page {pageIndex + 1} of {pages.length}</span>
          </div>
        </div>
        )
      })}
    </div>
  )
}
