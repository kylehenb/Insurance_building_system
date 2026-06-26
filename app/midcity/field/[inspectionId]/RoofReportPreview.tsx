'use client'

import { useEffect } from 'react'

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

type Photo = { id: string; previewUrl: string; label: string }

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
    <td style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, color: '#444', borderBottom: '1px solid #ebebeb', width: '58%', verticalAlign: 'top' as const }}>
      {label}
    </td>
    <td style={{ padding: '6px 14px', fontSize: 11, color: '#111', borderBottom: '1px solid #ebebeb', verticalAlign: 'top' as const }}>
      {v(val)}
    </td>
  </tr>
)

const YNR = ({ label, answer, details }: { label: string; answer: string; details?: string }) => (
  <>
    <tr>
      <td style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, color: '#444', borderBottom: details ? 'none' : '1px solid #ebebeb', width: '58%', verticalAlign: 'top' as const }}>
        {label}
      </td>
      <td style={{ padding: '6px 14px', fontSize: 11, color: '#111', borderBottom: details ? 'none' : '1px solid #ebebeb', verticalAlign: 'top' as const }}>
        {v(answer)}
      </td>
    </tr>
    {details && (
      <tr>
        <td colSpan={2} style={{ padding: '2px 14px 8px 26px', fontSize: 11, color: '#333', borderBottom: '1px solid #ebebeb', whiteSpace: 'pre-wrap' as const, lineHeight: 1.55 }}>
          {details}
        </td>
      </tr>
    )}
  </>
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

export function RoofReportPreview({
  fields,
  photos,
  jobInfo,
  onClose,
}: {
  fields: Fields
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
                  Roof Inspection Report
                </div>
                {jobLine && (
                  <div style={{ fontSize: 12, color: '#1a1a1a', fontWeight: 500, padding: '6px 10px', background: '#f5f5f5', borderLeft: '3px solid #2d2d2d', borderRadius: '0 3px 3px 0', marginTop: 4 }}>
                    {jobLine}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' as const, flexShrink: 0, fontSize: 11, color: '#444', lineHeight: 1.7 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: '#1a1a1a', marginBottom: 2 }}>Bindi Co</div>
                <div>Contact: {ROOFER_NAME}</div>
                <div>Ph: 0431 132 077</div>
                <div>E: kyle@binditrades.com.au</div>
                <div style={{ color: '#666', fontSize: 10, marginTop: 2 }}>BC103561 &nbsp; BP103432</div>
              </div>
            </div>

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

            {/* Statement of Objectivity */}
            <div style={{ padding: '18px 24px', borderTop: '1px solid #ddd' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.6px', color: '#222', marginBottom: 10 }}>
                Statement of Objectivity
              </div>
              <div style={{ fontSize: 11, color: '#333', lineHeight: 1.65 }}>
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
                Roof Inspection Report · Private &amp; Confidential
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  )
}
