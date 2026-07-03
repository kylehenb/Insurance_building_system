'use client'

import { useEffect } from 'react'

type MakeSafeFields = {
  claimDetails: string
  conductedOn: string
  description: string
}

type Photo = { id: string; previewUrl: string; label: string }

type JobInfo = {
  address: string | null
  insuredName: string | null
  insurer: string | null
  claimNumber: string | null
}

const CONTRACTOR = 'Bindi Co'

const v = (val: string) => val || '—'

const SH = ({ title }: { title: string }) => (
  <tr>
    <td colSpan={2} style={{
      background: '#2d2d2d', color: 'white',
      padding: '7px 14px', fontSize: 11, fontWeight: 700,
      letterSpacing: '0.8px', textTransform: 'uppercase' as const,
    }}>
      {title}
    </td>
  </tr>
)

const R = ({ label, val }: { label: string; val: string }) => (
  <tr>
    <td style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, color: '#444', borderBottom: '1px solid #ebebeb', width: '38%', verticalAlign: 'top' as const }}>
      {label}
    </td>
    <td style={{ padding: '6px 14px', fontSize: 11, color: '#111', borderBottom: '1px solid #ebebeb', verticalAlign: 'top' as const }}>
      {v(val)}
    </td>
  </tr>
)

const FR = ({ label, val }: { label: string; val: string }) => (
  <>
    <tr>
      <td colSpan={2} style={{ padding: '7px 14px 3px', fontSize: 11, fontWeight: 600, color: '#444', borderBottom: 'none' }}>
        {label}
      </td>
    </tr>
    <tr>
      <td colSpan={2} style={{ padding: '3px 14px 9px', fontSize: 11, color: '#111', borderBottom: '1px solid #ebebeb', whiteSpace: 'pre-wrap' as const, lineHeight: 1.6 }}>
        {v(val)}
      </td>
    </tr>
  </>
)

export function MakeSafeReportPreview({
  fields,
  photos,
  jobInfo,
  onClose,
}: {
  fields: MakeSafeFields
  photos: Photo[]
  jobInfo: JobInfo
  onClose: () => void
}) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const jobLine = fields.claimDetails || [
    jobInfo.insuredName,
    jobInfo.address,
    jobInfo.insurer,
    jobInfo.claimNumber ? `Claim #${jobInfo.claimNumber}` : null,
  ].filter(Boolean).join(' · ')

  const handlePrint = () => {
    const prevOverflow = document.body.style.overflow
    const prevTitle = document.title
    document.body.style.overflow = ''
    document.title = `Make Safe Report - ${jobLine}`
    window.print()
    window.addEventListener('afterprint', () => {
      document.body.style.overflow = prevOverflow || 'hidden'
      document.title = prevTitle
    }, { once: true })
  }

  return (
    <>
      <style>{`
        @page { margin: 15mm 18mm; size: A4 portrait; }
        @media print {
          body { overflow: visible !important; }
          .fa-root { display: none !important; }
          .mc-rrp-controls { display: none !important; }
          .mc-rrp-overlay {
            position: absolute !important;
            top: 0 !important; left: 0 !important; right: 0 !important;
            overflow: visible !important;
            height: auto !important;
            background: white !important;
            padding: 0 !important;
          }
          .mc-rrp-scroll {
            overflow: visible !important;
            padding: 0 !important;
          }
          .mc-rrp-doc {
            max-width: 100% !important;
            box-shadow: none !important;
            margin: 0 !important;
            padding: 0 !important;
          }
        }
      `}</style>

      <div className="mc-rrp-overlay" style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: '#edebe7', overflow: 'auto',
      }}>

        {/* Controls bar */}
        <div className="mc-rrp-controls" style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: '#1a1a1a', padding: '10px 20px',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <button
            onClick={onClose}
            style={{ background: 'none', border: '1px solid #555', color: '#ccc', padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
          >
            ← Back
          </button>
          <span style={{ flex: 1 }} />
          <button
            onClick={handlePrint}
            style={{ background: '#c8b89a', border: 'none', color: '#1a1a1a', padding: '8px 20px', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
          >
            Print / Download PDF
          </button>
        </div>

        {/* Report body */}
        <div className="mc-rrp-scroll" style={{ padding: '28px 16px 60px' }}>
          <div className="mc-rrp-doc" style={{
            maxWidth: 794, margin: '0 auto', background: 'white',
            boxShadow: '0 2px 20px rgba(0,0,0,0.14)',
            fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
          }}>

            {/* Header */}
            <div style={{ padding: '18px 24px 16px', borderBottom: '3px solid #1a1a1a', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#1a1a1a', letterSpacing: '-0.3px', marginBottom: 6 }}>
                  Make Safe Report
                </div>
                {jobLine && (
                  <div style={{ fontSize: 12, color: '#1a1a1a', fontWeight: 500, padding: '6px 10px', background: '#f5f5f5', borderLeft: '3px solid #2d2d2d', borderRadius: '0 3px 3px 0', marginTop: 4 }}>
                    {jobLine}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' as const, flexShrink: 0, fontSize: 11, color: '#444', lineHeight: 1.7 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: '#1a1a1a', marginBottom: 2 }}>Bindi Co</div>
                <div>Ph: 0431 132 077</div>
                <div>E: kyle@binditrades.com.au</div>
                <div style={{ color: '#666', fontSize: 10, marginTop: 2 }}>BC103561</div>
              </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <tbody>

                {/* Claim Details */}
                <SH title="Claim Details" />
                <R label="Customer Name, Loss Address, Insurer, Claim Number" val={jobLine} />

                {/* Make Safe Details */}
                <SH title="Make Safe Details" />
                <R label="Contractor" val={CONTRACTOR} />
                <R label="Conducted On" val={fields.conductedOn} />

                {/* Make Safe Description */}
                <SH title="Make Safe Description" />
                <FR label="Description of Works" val={fields.description} />

              </tbody>
            </table>

            {/* Photos */}
            {photos.length > 0 && (
              <div style={{ padding: '18px 24px', borderTop: '1px solid #ddd' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.6px', color: '#222', marginBottom: 14 }}>
                  Photo Record
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                  {photos.map((photo, idx) => (
                    <div key={photo.id} style={{ breakInside: 'avoid' as const }}>
                      <img
                        src={photo.previewUrl}
                        alt={photo.label || `Photo ${idx + 1}`}
                        style={{
                          width: '100%', aspectRatio: '4/3', objectFit: 'cover' as const,
                          borderRadius: 4, border: '1px solid #ddd', display: 'block',
                        }}
                      />
                      <div style={{ fontSize: 10, color: '#555', marginTop: 5, textAlign: 'center' as const }}>
                        Photo {idx + 1}{photo.label ? ` — ${photo.label}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div style={{ padding: '11px 24px', background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 9, color: '#c8b89a', letterSpacing: '1px', textTransform: 'uppercase' as const, fontWeight: 700 }}>
                Bindi Co
              </div>
              <div style={{ fontSize: 9, color: '#777' }}>
                Make Safe Report · Private &amp; Confidential
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  )
}
