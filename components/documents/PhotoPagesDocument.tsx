import type { PhotosPrintData } from '@/lib/documents/print-data'
import { PHOTO_PAGE_GEOMETRY, type PhotoLayoutBox } from '@/lib/documents/photo-layout'

// Photo pages for the emailed PDF (photos sent with work orders, Email
// Photos): rows fitted to each photo's shape, so nothing is cropped, with
// numbered labels in pills (lib/documents/photo-layout.ts). The browser print
// page (/print/jobs/[jobId]/photos) still uses the older grid
// (PhotosDocument) until it is retired.
//
// Sized for A4 with 10mm margins (lib/documents/render-print-document.ts).

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

export function PhotoPagesDocument({ job, photos, pages }: PhotoPagesDocumentProps) {
  const headerFields = [
    { label: 'Job #', value: job.job_number },
    { label: 'Address', value: job.property_address },
    { label: 'Claim #', value: job.claim_number },
    { label: 'Insured', value: job.insured_name },
  ].filter((f): f is { label: string; value: string } => Boolean(f.value))

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", color: '#1a1a1a', background: 'white' }}>
      {pages.map((boxes, pageIndex) => (
        <div
          key={pageIndex}
          style={{
            position: 'relative',
            height: `${PAGE_H}px`,
            overflow: 'hidden',
            flexShrink: 0,
            breakAfter: pageIndex < pages.length - 1 ? 'page' : 'auto',
          }}
        >
          {/* Per-page header (as the photo print page) */}
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
            <span>Photos</span>
            <span>Page {pageIndex + 1} of {pages.length}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
