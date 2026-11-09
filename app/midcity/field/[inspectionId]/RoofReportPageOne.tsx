'use client'

import { useState } from 'react'
import { isWideImage, issueColour, problemSummaries, splitIssueLetters } from '@/lib/photos/roof-tags'
import type { OverviewMark } from '@/lib/photos/overview-marks'
import { OverviewWithMarkup } from './OverviewMarkup'

// The roof report's first page (layout "C2"): the roof from above with each
// problem's letter pinned on it (plus any areas, arrows and labels), the problems beside it, then the short cause,
// what happens next and the roof at a glance. A wide screenshot goes full
// width with the problems underneath; the image is never cropped, and the marks
// sit at their place on the image (fractions across and down), whatever size it's drawn.

export interface PageOneFields {
  causeSummary?: string
  problemSummaries?: string
  specificCause: string
  attendanceDate: string
  roofType: string; roofPitch: string; propertyAge: string; roofGeneralCondition: string
  numberOfStoreys: string; claimType: string
  maintenanceRepairsRequired: string; requiredMaintenanceDetails: string
  makeSafeCompleted: string; makeSafeCompletedDetails: string; makeSafeRequired: string
  propertyConditionsContributed: string
}

const INK = '#26201f'
const MUTED = '#8a807e'
const LINE = '#d9d4d2'
const ACCENT = 'var(--ink)'
const HEAD_FONT = 'var(--font-geist-sans), system-ui, sans-serif'

const Heading = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontFamily: HEAD_FONT, fontSize: 15, fontWeight: 600, borderBottom: `1px solid ${LINE}`, paddingBottom: 5 }}>{children}</div>
)

const Lettered = ({ text }: { text: string }) => (
  <>
    {splitIssueLetters(text).map((part, i) => part.letter
      ? <span key={i} style={{ color: issueColour(part.letter), fontWeight: 800 }}>{part.text}</span>
      : <span key={i}>{part.text}</span>)}
  </>
)

export function RoofReportPageOne({ fields, job, overview, imageSize = null }: {
  fields: PageOneFields
  job: { address: string | null; insuredName: string | null; claimNumber: string | null; jobNumber: string | null }
  overview: { url: string; marks: OverviewMark[] } | null
  /** The overview's size when already known; otherwise it's read when the image loads */
  imageSize?: { w: number; h: number } | null
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(imageSize)
  const wide = !!size && isWideImage(size.w, size.h)
  const problems = problemSummaries(fields.problemSummaries, fields.specificCause)
  // The short cause; without one, the lead line of the full cause
  const cause = fields.causeSummary?.trim() || fields.specificCause.split('\n')[0]?.trim() || ''
  const maintenance = fields.maintenanceRepairsRequired === 'No' ? 'None required' : fields.requiredMaintenanceDetails.trim()

  const problemList = (
    <div style={{ display: 'flex', flexDirection: wide ? 'row' : 'column', gap: wide ? 16 : 0 }}>
      {problems.length === 0 && <div style={{ fontSize: 12.5, color: MUTED, padding: '12px 0' }}>No problems with the roof cover were found.</div>}
      {problems.map(p => (
        <div key={p.letter} style={{ flex: wide ? '1 1 0' : undefined, display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 0', borderBottom: wide ? 'none' : '1px solid #eeeae9', borderTop: wide ? `4px solid ${issueColour(p.letter)}` : 'none' }}>
          {!wide && (
            <div style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%', background: issueColour(p.letter), color: '#fff', fontWeight: 800, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>{p.letter}</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {(p.location || wide) && <span style={{ fontSize: wide ? 12 : 9, color: wide ? issueColour(p.letter) : MUTED, fontWeight: wide ? 800 : 400 }}>{wide ? `(${p.letter}) ` : ''}{p.location}</span>}
            <span style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.4 }}>{p.text}</span>
          </div>
        </div>
      ))}
    </div>
  )

  const maintenanceBlock = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Heading>Maintenance Required</Heading>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: maintenance && maintenance !== 'None required' ? '#b8602a' : INK, lineHeight: 1.6, whiteSpace: 'pre-line' }}>{maintenance || '—'}</div>
    </div>
  )

  return (
    <div className="mc-rrp-page-one" style={{ padding: '30px 40px 22px', fontFamily: 'var(--font-dm-sans), system-ui, sans-serif', color: INK, display: 'flex', flexDirection: 'column', minHeight: 1080, boxSizing: 'border-box', breakAfter: 'page' }}>

      {/* Header: company, job details, date */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
            <span style={{ fontFamily: HEAD_FONT, fontWeight: 800, fontSize: 19, letterSpacing: 1.5 }}>BINDI CO</span>
            <span style={{ fontFamily: HEAD_FONT, fontWeight: 600, fontSize: 8.5, letterSpacing: 3.5, color: '#6b5f5d', marginTop: 3 }}>ROOF REPORTS</span>
          </div>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: '#6b5f5d', flexGrow: 1, minWidth: 0 }}>
          <div>
            {job.claimNumber && <><b style={{ color: INK }}>Claim:</b> {job.claimNumber} · </>}
            <b style={{ color: INK }}>Job:</b> {job.jobNumber || '—'}
          </div>
          {job.insuredName && <div><b style={{ color: INK }}>Insured:</b> {job.insuredName}</div>}
          <div><b style={{ color: INK }}>Address:</b> {job.address || '—'}</div>
        </div>
        {fields.attendanceDate && <div style={{ fontSize: 11, color: '#6b5f5d', alignSelf: 'flex-start', whiteSpace: 'nowrap' }}>Attended: {fields.attendanceDate}</div>}
      </div>

      <div style={{ height: 9, borderRadius: 6, background: ACCENT, margin: '18px 0 16px', printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }} />

      <div style={{ fontFamily: HEAD_FONT, fontSize: 28, fontWeight: 600, letterSpacing: -0.3, marginBottom: 14 }}>Roof Inspection Summary</div>

      {/* The roof overview and the problems: side by side, or stacked for a wide screenshot */}
      {overview && wide ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'center', background: '#f4f1f0' }}>
            <OverviewWithMarkup url={overview.url} marks={overview.marks} maxHeight={420} size={size} onSize={(w, h) => setSize({ w, h })} />
          </div>
          {problemList}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: overview ? 'repeat(5, minmax(0, 1fr))' : '1fr', gap: 24 }}>
          {overview && (
            <div style={{ gridColumn: 'span 3', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', background: '#f4f1f0' }}>
              <OverviewWithMarkup url={overview.url} marks={overview.marks} maxHeight={470} size={size} onSize={(w, h) => setSize({ w, h })} />
            </div>
          )}
          <div style={{ gridColumn: overview ? 'span 2' : undefined, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontFamily: HEAD_FONT, fontSize: 15, fontWeight: 600, borderBottom: `1px solid ${LINE}`, paddingBottom: 5, marginBottom: 4 }}>Problems Found</div>
            {problemList}
          </div>
        </div>
      )}

      {/* The short cause, then maintenance: each across the full page */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 24 }}>
        <Heading>Cause of Damage</Heading>
        <div style={{ fontSize: 12.5, lineHeight: 1.6 }}><Lettered text={cause || '—'} /></div>
      </div>
      <div style={{ marginTop: 20 }}>{maintenanceBlock}</div>

      <div style={{ marginTop: 'auto', paddingTop: 22 }}>
        <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 9, color: '#9a908e', letterSpacing: 1 }}>
          <span style={{ background: INK, color: '#ffffff', fontFamily: HEAD_FONT, fontWeight: 800, fontSize: 11, letterSpacing: 2, padding: '3px 7px', printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>BINDI CO</span>
          <span>BINDITRADES.COM.AU</span>
          <span>ROOF INSPECTION REPORT</span>
          <span>PG. 1</span>
        </div>
      </div>
    </div>
  )
}
