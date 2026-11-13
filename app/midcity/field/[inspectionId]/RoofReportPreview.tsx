'use client'

import { Fragment, useEffect } from 'react'
import { splitDotPoints } from '@/lib/reports/dot-points'
import { RoofReportPageOne } from './RoofReportPageOne'
import { PhotoWithMarkup } from './OverviewMarkup'
import { ROOF_TAGS, issueColour, issuePoints, orderRoofPhotos, parseRoofLabel, splitIssueLetters } from '@/lib/photos/roof-tags'
import type { OverviewMark } from '@/lib/photos/overview-marks'

type Fields = {
  claimDetails: string
  attendanceDate: string; timeAttended: string; rooferName: string
  rooferQualification: string; rooferMetWith: string; timeOnSite: string; scopeOfAssessment: string
  propertyAge: string; wallConstruction: string; propertyType: string
  propertyCondition: string; numberOfStoreys: string
  roofType: string; roofGeneralCondition: string; roofPitch: string
  numberOfPenetrations: string; roofInsulationType: string
  solarPV: string; roofMountedSolarHWS: string; numberOfSkylights: string
  skylightFlashingsWatertight: string; skylightFlashingsNotes: string
  guttersCompliant: string; guttersNotes: string
  downpipesCompliant: string; corrosionIronizedWater: string; downpipeSize: string
  roofStructureTiedDown: string; battenSizeCompliant: string; trussRafterCompliant: string
  claimType: string; specificCause: string
  causeSummary?: string; problemSummaries?: string
  clientDiscussion: string
  propertyConditionsContributed: string; propertyConditionsDetails: string
  damageWithoutConditions: string; damageWithoutConditionsDetails: string
  customerAwareOfConditions: string; customerAwareDetails: string
  otherPropertyConditionIssues: string; otherPropertyConditionDetails: string
  maintenanceRepairsRequired: string; requiredMaintenanceDetails: string; recommendedMaintenanceDetails: string
  conditionsPreventRepairs: string; conditionsPreventRepairsDetails: string
  previousRepairs: string; previousRepairsDetails: string
  buildingCodeViolations: string; buildingCodeViolationsDetails: string
  accessConcerns: string; healthSafetyConcerns: string
  makeSafeCompleted: string; makeSafeCompletedDetails: string; makeSafeRequired: string
}

type Photo = { id: string; previewUrl: string; label: string; cropX?: number; cropY?: number; cropScale?: number; marks?: OverviewMark[] }

type JobInfo = {
  address: string | null
  insuredName: string | null
  insurer: string | null
  claimNumber: string | null
  jobNumber: string | null
}

const ROOFER_NAME = 'Kyle Bindon'
const ROOFER_QUAL = 'Roof Plumber, Registered Builder BP103432'

const v = (val: string) => val || '—'

// The report body in page one's look (RoofReportPageOne.tsx): white page, the
// phone's own font, section titles over a hairline, grey labels with dark
// answers, yes/no answers as small pills, charcoal only for the rule and footer.
const INK = '#1c1c1e'
const MUTED = '#6e6e73'
const LINE = '#e5e5ea'
const PAD = 40
const HEAD_FONT = 'var(--font-geist-sans), var(--font-dm-sans), system-ui, sans-serif'
const PRINT_EXACT = { printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' } as const

// "Yes" / "No" / "N/A" (and Good / Fair / Poor) as a small pill; anything else as text
const Answer = ({ val }: { val: string }) => {
  const t = (val ?? '').trim()
  if (!/^(yes|no|n\/a|good|fair|poor)$/i.test(t)) return <>{v(t)}</>
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, background: '#f2f2f7', color: INK, fontWeight: 700, fontSize: 11, ...PRINT_EXACT }}>{t}</span>
  )
}

const PHOTO_PILL: React.CSSProperties = {
  position: 'absolute', top: 6, left: 6, maxWidth: '78%',
  display: 'flex', alignItems: 'flex-start', gap: 5,
  background: 'rgba(26,26,26,0.72)', color: '#ffffff', borderRadius: 4,
  padding: '3px 7px 3px 3px', fontSize: 9.5, fontWeight: 500, lineHeight: 1.35,
  printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact',
}
const PHOTO_CHIP: React.CSSProperties = {
  background: '#ffffff', color: 'var(--ink)', borderRadius: 3, padding: '0 5px', fontWeight: 700, flexShrink: 0,
}

// "(A)" problem letters in their colour, matching the photo pills
const Lettered = ({ text }: { text: string }) => (
  <>
    {splitIssueLetters(text).map((part, i) => part.letter
      ? <span key={i} style={{ color: issueColour(part.letter), fontWeight: 800 }}>{part.text}</span>
      : <span key={i}>{part.text}</span>)}
  </>
)

// Text with "• " dot points: each point on its own line with a hanging indent
const Points = ({ text }: { text: string }) => {
  if (!text?.trim()) return <>—</>
  const lines = splitDotPoints(text)
  const hasPoints = lines.some(l => l.point)
  return (
    <>
      {lines.map((line, i) => line.point ? (
        <div key={i} style={{ display: 'flex', gap: 7, marginTop: i ? 3 : 0 }}>
          <span style={{ flexShrink: 0 }}>•</span>
          <span><Lettered text={line.text} /></span>
        </div>
      ) : (
        <div key={i} style={{ marginTop: i ? 5 : 0, fontWeight: hasPoints && i === 0 ? 600 : undefined }}><Lettered text={line.text} /></div>
      ))}
    </>
  )
}

const SH = ({ title }: { title: string }) => (
  <tr style={{ breakAfter: 'avoid' as const }}>
    <td colSpan={2} style={{
      padding: '22px 0 6px', fontFamily: HEAD_FONT, fontSize: 15, fontWeight: 600, color: INK,
      borderBottom: `1.5px solid ${INK}`,
    }}>
      {title}
    </td>
  </tr>
)

const LABEL_TD: React.CSSProperties = { padding: '8px 16px 8px 0', fontSize: 11, color: MUTED, width: '58%', verticalAlign: 'top', lineHeight: 1.45 }
const VALUE_TD: React.CSSProperties = { padding: '8px 0', fontSize: 12, fontWeight: 600, color: INK, verticalAlign: 'top', lineHeight: 1.45 }

const R = ({ label, val }: { label: string; val: string }) => (
  <tr style={{ breakInside: 'avoid' as const }}>
    <td style={{ ...LABEL_TD, borderBottom: `1px solid ${LINE}` }}>{label}</td>
    <td style={{ ...VALUE_TD, borderBottom: `1px solid ${LINE}` }}><Answer val={val} /></td>
  </tr>
)

const YNR = ({ label, answer, details }: { label: string; answer: string; details?: string }) => (
  <>
    <tr style={{ breakInside: 'avoid' as const }}>
      <td style={{ ...LABEL_TD, borderBottom: details ? 'none' : `1px solid ${LINE}` }}>{label}</td>
      <td style={{ ...VALUE_TD, borderBottom: details ? 'none' : `1px solid ${LINE}` }}><Answer val={answer} /></td>
    </tr>
    {details && (
      <tr style={{ breakInside: 'avoid' as const }}>
        <td colSpan={2} style={{ padding: '0 0 10px 14px', fontSize: 11.5, color: INK, borderBottom: `1px solid ${LINE}`, lineHeight: 1.55 }}>
          <div style={{ borderLeft: `2px solid ${LINE}`, paddingLeft: 10 }}><Points text={details} /></div>
        </td>
      </tr>
    )}
  </>
)

const FR = ({ label, val }: { label: string; val: string }) => (
  <>
    <tr style={{ breakAfter: 'avoid' as const }}>
      <td colSpan={2} style={{ padding: '9px 0 3px', fontSize: 11, color: MUTED }}>
        {label}
      </td>
    </tr>
    <tr>
      <td colSpan={2} style={{ padding: '2px 0 10px', fontSize: 12, color: INK, borderBottom: `1px solid ${LINE}`, lineHeight: 1.6 }}>
        <Points text={val} />
      </td>
    </tr>
  </>
)

export function RoofReportPreview({
  fields,
  photos,
  jobInfo,
  overview = null,
  onClose,
}: {
  fields: Fields
  photos: Photo[]
  jobInfo: JobInfo
  /** The roof overview photo with its markup (problem pins, areas, arrows, labels), for page one */
  overview?: { url: string; marks: OverviewMark[] } | null
  onClose: () => void
}) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // Report order: front view, roof overview, each problem's photos (A, B…), then the rest
  const orderedPhotos = orderRoofPhotos(photos)
  const issueText = new Map(issuePoints(fields.specificCause).map(i => [i.letter, i.text]))

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
    document.title = `Roof report - ${jobLine}`
    window.print()
    window.addEventListener('afterprint', () => {
      document.body.style.overflow = prevOverflow || 'hidden'
      document.title = prevTitle
    }, { once: true })
  }

  const maintenanceDetails = [
    fields.requiredMaintenanceDetails ? `REQUIRED\n${fields.requiredMaintenanceDetails}` : '',
    fields.recommendedMaintenanceDetails ? `RECOMMENDED\n${fields.recommendedMaintenanceDetails}` : '',
  ].filter(Boolean).join('\n\n') || undefined

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
          .mc-rrp-page-one {
            min-height: 0 !important;
            height: 262mm;
            padding: 0 !important;
          }
          .mc-rrp-page-gap { display: none !important; }
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
          background: 'var(--ink)', padding: '10px 20px',
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
            style={{ background: '#007aff', border: 'none', color: 'white', padding: '8px 20px', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
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

            {/* Page one: the roof overview with the problems pinned on it, at a glance */}
            <RoofReportPageOne
              fields={fields}
              job={{ address: jobInfo.address, insuredName: jobInfo.insuredName, claimNumber: jobInfo.claimNumber, jobNumber: jobInfo.jobNumber }}
              overview={overview}
            />
            <div className="mc-rrp-page-gap" style={{ height: 18, background: '#edebe7' }} />

            {/* Header: as page one — company and contact, the charcoal rule, the title */}
            <div className="mc-rrp-body-head" style={{ padding: `30px ${PAD}px 0`, fontFamily: 'var(--font-dm-sans), system-ui, sans-serif' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}>
                <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
                  <span style={{ fontFamily: HEAD_FONT, fontWeight: 800, fontSize: 19, letterSpacing: 1.5, color: INK }}>BINDI CO</span>
                  <span style={{ fontFamily: HEAD_FONT, fontWeight: 600, fontSize: 8.5, letterSpacing: 3.5, color: MUTED, marginTop: 3 }}>ROOF REPORTS</span>
                </div>
                <div style={{ textAlign: 'right' as const, fontSize: 11, color: MUTED, lineHeight: 1.6 }}>
                  <div><b style={{ color: INK }}>{ROOFER_NAME}</b> · {ROOFER_QUAL}</div>
                  <div>0431 132 077 · kyle@binditrades.com.au</div>
                  <div>BC103561 · BP103432</div>
                </div>
              </div>
              <div style={{ height: 9, borderRadius: 6, background: INK, margin: '18px 0 16px', ...PRINT_EXACT }} />
              <div style={{ fontFamily: HEAD_FONT, fontSize: 24, fontWeight: 600, letterSpacing: -0.3, color: INK }}>Roof Inspection Report</div>
              {jobLine && <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>{jobLine}</div>}
            </div>

            <div style={{ padding: `0 ${PAD}px`, fontFamily: 'var(--font-dm-sans), system-ui, sans-serif' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <tbody>

                {/* ── Claim Details ── */}
                <SH title="Claim Details" />
                <R label="Customer Name, Loss Address, Insurer, Claim Number" val={jobLine} />

                {/* ── Assessment Report Details ── */}
                <SH title="Assessment Report Details" />
                <R label="Attendance Date" val={fields.attendanceDate} />
                <R label="Time Attended" val={fields.timeAttended} />
                <R label="Roofer's Name" val={ROOFER_NAME} />
                <R label="Roofer's Qualification" val={ROOFER_QUAL} />
                <R label="Roofer Met With" val={fields.rooferMetWith} />
                <R label="Amount of Time on Site" val={fields.timeOnSite} />
                <FR label="Scope of Assessment" val={fields.scopeOfAssessment} />

                {/* ── Property Details ── */}
                <SH title="Property Details" />
                <R label="Approximate Age of Residence / Property" val={fields.propertyAge} />
                <R label="Wall Construction Type" val={fields.wallConstruction} />
                <R label="Property Type" val={fields.propertyType} />
                <R label="Property Condition" val={fields.propertyCondition} />
                <R label="Number of Storeys" val={fields.numberOfStoreys} />

                {/* ── Roof Details ── */}
                <SH title="Roof Details" />
                <R label="Roof Type" val={fields.roofType} />
                <R label="General Condition of Roof" val={fields.roofGeneralCondition} />
                <R label="Roof Pitch (in degrees)" val={fields.roofPitch} />
                <R label="Number of Penetrations" val={fields.numberOfPenetrations} />
                <R label="Roof Insulation Type (sarking, anticon, air-cell) — excludes ceiling insulation" val={fields.roofInsulationType} />
                <R label="Solar PV" val={fields.solarPV} />
                <R label="Roof Mounted Solar HWS" val={fields.roofMountedSolarHWS} />
                <R label="Number of Skylights" val={fields.numberOfSkylights} />
                <YNR
                  label="Are skylight flashings watertight and flashed correctly?"
                  answer={fields.skylightFlashingsWatertight}
                  details={fields.skylightFlashingsNotes || undefined}
                />
                <YNR
                  label="Are the gutters compliant with current building codes?"
                  answer={fields.guttersCompliant}
                  details={fields.guttersNotes || undefined}
                />
                <R label="Are the number of downpipes compliant with current building codes?" val={fields.downpipesCompliant} />
                <R label="Is there corrosion due to ironized water?" val={fields.corrosionIronizedWater} />
                <R label="Downpipe Size" val={fields.downpipeSize} />
                <R label="Is the roof structure tied down &amp; / or compliant with current building codes?" val={fields.roofStructureTiedDown} />
                <R label="Is the batten size &amp; spacing compliant with current building codes?" val={fields.battenSizeCompliant} />
                <R label="Are the truss / rafter size &amp; spacing appropriate and compliant with current building codes?" val={fields.trussRafterCompliant} />

                {/* ── Cause of Damage ── */}
                <SH title="Cause of Damage" />
                <R label="Claim Type" val={fields.claimType} />
                <FR label="Specific Cause" val={fields.specificCause} />

                {/* ── Client Discussion ── */}
                <SH title="Client Discussion" />
                <FR label="Client Stated" val={fields.clientDiscussion} />

                {/* ── Roof Conditions ── */}
                <SH title="Roof Conditions" />
                <YNR
                  label="Are there any property conditions that contributed to the claim damage — eg. rust, wood rot, leaks, defects, installation faults, design etc.?"
                  answer={fields.propertyConditionsContributed}
                  details={fields.propertyConditionsContributed === 'Yes' ? (fields.propertyConditionsDetails || undefined) : undefined}
                />
                <YNR
                  label="If the property were in a good condition prior to the incident, would the resultant damage still have occurred?"
                  answer={fields.damageWithoutConditions}
                  details={fields.damageWithoutConditions === 'Yes' ? (fields.damageWithoutConditionsDetails || undefined) : undefined}
                />
                <YNR
                  label="Would the customer have been reasonably aware of the property conditions?"
                  answer={fields.customerAwareOfConditions}
                  details={fields.customerAwareOfConditions === 'Yes' ? (fields.customerAwareDetails || undefined) : undefined}
                />
                <YNR
                  label="Are there any other issues relating to the property's conditions? (eg. structural integrity, water tightness, non-claim related issues)"
                  answer={fields.otherPropertyConditionIssues}
                  details={fields.otherPropertyConditionIssues === 'Yes' ? (fields.otherPropertyConditionDetails || undefined) : undefined}
                />
                <YNR
                  label="Are there any maintenance repairs required to reduce the risk of additional damage in the future?"
                  answer={fields.maintenanceRepairsRequired}
                  details={maintenanceDetails}
                />
                <YNR
                  label="Do any of the property conditions or maintenance items prevent warrantable claim repairs?"
                  answer={fields.conditionsPreventRepairs}
                  details={fields.conditionsPreventRepairs === 'Yes' ? (fields.conditionsPreventRepairsDetails || undefined) : undefined}
                />
                <YNR
                  label="Has your inspection revealed any previous repairs?"
                  answer={fields.previousRepairs}
                  details={fields.previousRepairs === 'Yes' ? (fields.previousRepairsDetails || undefined) : undefined}
                />
                <YNR
                  label="Has your inspection revealed any violation of building codes or laws that apply to now or at the time of property construction / last renovation?"
                  answer={fields.buildingCodeViolations}
                  details={fields.buildingCodeViolations === 'Yes' ? (fields.buildingCodeViolationsDetails || undefined) : undefined}
                />

                {/* ── Access and Safety ── */}
                <SH title="Access and Safety" />
                <R label="Are there any access concerns that would prevent fulfilling the repairs in full?" val={fields.accessConcerns} />
                <R label="Are there any health and safety concerns that would prevent fulfilling the repairs in full?" val={fields.healthSafetyConcerns} />

                {/* ── Additional Information ── */}
                <SH title="Additional Information" />
                <YNR
                  label="Has a make safe been completed?"
                  answer={fields.makeSafeCompleted}
                  details={fields.makeSafeCompleted === 'Yes' ? (fields.makeSafeCompletedDetails || undefined) : undefined}
                />
                <R label="Is a Make Safe Required?" val={fields.makeSafeRequired} />

              </tbody>
            </table>
            </div>

            {/* Statement of Objectivity */}
            <div style={{ padding: `26px ${PAD}px 8px`, fontFamily: 'var(--font-dm-sans), system-ui, sans-serif', breakInside: 'avoid' as const }}>
              <div style={{ fontFamily: HEAD_FONT, fontSize: 15, fontWeight: 600, color: INK, borderBottom: `1.5px solid ${INK}`, paddingBottom: 6, marginBottom: 10 }}>
                Statement of Objectivity
              </div>
              <div style={{ fontSize: 11, color: '#3a3a3c', lineHeight: 1.65 }}>
                <p style={{ marginTop: 0, marginBottom: 8 }}>
                  I {ROOFER_NAME} have prepared this expert report for Bindi Co. I confirm the following:
                </p>
                <p style={{ marginTop: 0, marginBottom: 8 }}>
                  <strong>1. Independence:</strong> I am an independent expert, and I am not employed by nor have any financial or other interest in the outcome of this claim.
                </p>
                <p style={{ marginTop: 0, marginBottom: 8 }}>
                  <strong>2. Preparation:</strong> I have prepared this expert report without influence or direction from the insured, Bindi Co or other expert or supplier as is relevant. I have used plain and clear language, free from inconsistencies or contradictions. This expert report includes the supporting information relied upon, relevant issues, reasoning, evidence relied upon and conclusions.
                </p>
                <p style={{ marginTop: 0, marginBottom: 8 }}>
                  <strong>3. Objectivity:</strong> Where I have provided an assumption or an opinion, I have done so within the scope of my professional expertise and qualifications, as set out in this expert report and substantiated with facts. Where I have expressed an opinion, I have included whether such opinion is tentative or firm. The information contained in this expert report is factually objective, neutral and all references have been explained.
                </p>
                <p style={{ marginTop: 0, marginBottom: 8 }}>
                  <strong>4. Comprehensive Findings:</strong> Where I have considered multiple questions, I have included the extent each cause, if more than one, contributes to the loss. Where necessary, I have stated if further issues outside Bindi Co&apos;s briefing need to be investigated to provide a comprehensive report.
                </p>
                <p style={{ marginTop: 0, marginBottom: 0 }}>
                  <strong>5. Unbiased Findings:</strong> I confirm that my findings remain independent of my relationship with the insured / Bindi Co and any other expert or supplier as is relevant.
                </p>
              </div>
            </div>

            {/* Photos */}
            {photos.length > 0 && (
              <div style={{ padding: `26px ${PAD}px 18px`, fontFamily: 'var(--font-dm-sans), system-ui, sans-serif' }}>
                <div style={{ fontFamily: HEAD_FONT, fontSize: 15, fontWeight: 600, color: INK, borderBottom: `1.5px solid ${INK}`, paddingBottom: 6, marginBottom: 14 }}>
                  Photographs
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                  {orderedPhotos.map((photo, idx) => {
                    const { tag, note } = parseRoofLabel(photo.label)
                    const colour = tag.kind === 'issue' ? issueColour(tag.letter) : null
                    const text = tag.kind === 'issue'
                      ? [`(${tag.letter})`, note].filter(Boolean).join(' ')
                      : tag.kind === 'type'
                        ? [ROOF_TAGS.find(t => t.key === tag.key)!.label, note].filter(Boolean).join(' - ')
                        : note
                    // Each problem's photos start under a heading in its colour
                    const prev = idx > 0 ? parseRoofLabel(orderedPhotos[idx - 1].label).tag : null
                    const heading = tag.kind === 'issue' && !(prev?.kind === 'issue' && prev.letter === tag.letter)
                      ? issueText.get(tag.letter) ?? ''
                      : null
                    // After the problems, the rest start on their own row so they don't read as part of the last one
                    const otherPhotos = tag.kind !== 'issue' && prev?.kind === 'issue'
                    return (
                      <Fragment key={photo.id}>
                        {heading !== null && (
                          <div style={{ gridColumn: '1 / -1', fontSize: 12, fontWeight: 700, color: colour!, borderBottom: `2px solid ${colour}`, paddingBottom: 4, marginTop: idx ? 6 : 0 }}>
                            ({(tag as { letter: string }).letter}) {heading}
                          </div>
                        )}
                        {otherPhotos && (
                          <div style={{ gridColumn: '1 / -1', fontSize: 12, fontWeight: 700, color: MUTED, borderBottom: `2px solid ${LINE}`, paddingBottom: 4, marginTop: 6 }}>
                            Other photos
                          </div>
                        )}
                        <div style={{ breakInside: 'avoid' as const }}>
                          <div style={{ position: 'relative', height: 260, overflow: 'hidden', background: '#f2f2f7', borderRadius: 8, border: colour ? `2px solid ${colour}` : `1px solid ${LINE}` }}>
                            <PhotoWithMarkup url={photo.previewUrl} alt={photo.label || `Photo ${idx + 1}`} marks={photo.marks}
                              transform={`translate(${photo.cropX ?? 0}%, ${photo.cropY ?? 0}%) scale(${photo.cropScale ?? 1})`} />
                            {/* Number and label in a pill on the photo; a problem's pill is in its colour */}
                            <div style={{ ...PHOTO_PILL, ...(colour ? { background: colour } : {}) }}>
                              <span style={{ ...PHOTO_CHIP, ...(colour ? { background: 'white', color: colour } : {}) }}>{idx + 1}</span>
                              {text && <span>{text}</span>}
                            </div>
                          </div>
                        </div>
                      </Fragment>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Footer */}
            <div style={{ padding: `0 ${PAD}px 22px`, fontFamily: 'var(--font-dm-sans), system-ui, sans-serif' }}>
              <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 9, color: '#8e8e93', letterSpacing: 1 }}>
                <span style={{ background: INK, color: '#ffffff', fontFamily: HEAD_FONT, fontWeight: 800, fontSize: 11, letterSpacing: 2, padding: '3px 7px', ...PRINT_EXACT }}>BINDI CO</span>
                <span>BINDITRADES.COM.AU</span>
                <span>ROOF INSPECTION REPORT · PRIVATE &amp; CONFIDENTIAL</span>
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  )
}
