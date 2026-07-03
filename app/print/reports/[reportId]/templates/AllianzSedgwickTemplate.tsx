import type { Database } from '@/lib/supabase/database.types'

type Report = Database['public']['Tables']['reports']['Row']
type Job = Database['public']['Tables']['jobs']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']
type Photo = Database['public']['Tables']['photos']['Row']

interface Props {
  report: Report
  job: Job
  tenant: Tenant
  photos: Photo[]
}

function tsf(report: Report, key: string): string {
  const fields = report.type_specific_fields as Record<string, unknown> | null
  if (!fields) return '—'
  const val = fields[key]
  if (val === null || val === undefined || val === '') return '—'
  return String(val)
}

const formatDate = (date: string | null) => {
  if (!date) return '—'
  const d = new Date(date)
  if (isNaN(d.getTime())) return date
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Preserve newlines / bullet points for observation text
function renderText(text: string | null): React.ReactNode {
  if (!text || text === '—') return <span style={{ color: '#6b7280' }}>—</span>
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '') {
      nodes.push(<div key={i} style={{ height: '6px' }} />)
    } else if (/^[•\-\*]\s/.test(line) || /^\d+[\.)]\s/.test(line)) {
      nodes.push(
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '3px' }}>
          <span style={{ marginRight: '6px', flexShrink: 0 }}>{line[0]}</span>
          <span>{line.substring(1).trim()}</span>
        </div>
      )
    } else {
      nodes.push(<div key={i} style={{ marginBottom: '2px' }}>{line}</div>)
    }
  }
  return <>{nodes}</>
}

// ——— Shared style tokens ——————————————————————————————————————————
const FONT = 'Arial, Helvetica, sans-serif'
const BORDER = '1px solid #d1d5db'
const HEADER_BG = '#f3f4f6'
const SUBHEADER_BG = '#e5e7eb'
const CELL_PAD = '7px 10px'
const LABEL_COLOR = '#374151'
const VALUE_COLOR = '#111827'
const SECTION_TITLE_COLOR = '#111827'

// Section header band (numbered sections: "1. Property Information")
function SectionBand({ title }: { title: string }) {
  return (
    <tr>
      <td
        colSpan={2}
        style={{
          background: HEADER_BG,
          borderTop: BORDER,
          borderBottom: BORDER,
          padding: '5px 10px',
          fontSize: '11px',
          fontWeight: '700',
          color: SECTION_TITLE_COLOR,
          fontFamily: FONT,
          letterSpacing: '0.3px',
        }}
      >
        {title}
      </td>
    </tr>
  )
}

// Sub-heading row (e.g. "Property Description", "Evidence Supplied by the Customer")
function SubHeadRow({ title }: { title: string }) {
  return (
    <tr>
      <td
        colSpan={2}
        style={{
          background: SUBHEADER_BG,
          borderBottom: BORDER,
          padding: '4px 10px',
          fontSize: '10.5px',
          fontWeight: '700',
          color: LABEL_COLOR,
          fontFamily: FONT,
        }}
      >
        {title}
      </td>
    </tr>
  )
}

// Standard key-value row
function KVRow({
  label,
  value,
  labelWidth = '38%',
}: {
  label: string
  value: React.ReactNode
  labelWidth?: string
}) {
  return (
    <tr>
      <td
        style={{
          width: labelWidth,
          padding: CELL_PAD,
          borderBottom: BORDER,
          borderRight: BORDER,
          fontSize: '10.5px',
          fontWeight: '700',
          color: LABEL_COLOR,
          verticalAlign: 'top',
          fontFamily: FONT,
        }}
      >
        {label}
      </td>
      <td
        style={{
          padding: CELL_PAD,
          borderBottom: BORDER,
          fontSize: '10.5px',
          color: VALUE_COLOR,
          verticalAlign: 'top',
          fontFamily: FONT,
          lineHeight: '1.5',
        }}
      >
        {value}
      </td>
    </tr>
  )
}

// Full-width text row (e.g. property description paragraph)
function TextRow({ text }: { text: string | null }) {
  return (
    <tr>
      <td
        colSpan={2}
        style={{
          padding: CELL_PAD,
          borderBottom: BORDER,
          fontSize: '10.5px',
          color: VALUE_COLOR,
          fontFamily: FONT,
          lineHeight: '1.6',
        }}
      >
        {renderText(text)}
      </td>
    </tr>
  )
}

// ——— Sedgwick logo ————————————————————————————————————————————————
function SedgwickHeader() {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '18px 0 14px',
        borderBottom: '1px solid #e5e7eb',
        marginBottom: '20px',
        fontFamily: FONT,
      }}
    >
      <img
        src="/sedgwick-logo.png"
        alt="Sedgwick Repair Solutions"
        style={{ height: '36px', width: 'auto', display: 'inline-block' }}
      />
    </div>
  )
}

// ——— Cover page ——————————————————————————————————————————————————
function CoverPage({ report, job, tenant }: { report: Report; job: Job; tenant: Tenant }) {
  const reportDate = tsf(report, 'date_report_prepared') || new Date().toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <div
      style={{
        pageBreakAfter: 'always',
        minHeight: '260mm',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: FONT,
        padding: '0 40px',
      }}
    >
      <SedgwickHeader />

      {/* IRC logo + company */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '60px' }}>
        <img
          src="/logo-alt.png"
          alt="IRC Logo"
          style={{ width: '70px', height: 'auto' }}
        />
        <div>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#111827' }}>
            Insurance Repair Co Pty Ltd
          </div>
        </div>
      </div>

      {/* Report type title */}
      <div style={{ textAlign: 'center', marginBottom: '60px' }}>
        <div
          style={{
            fontSize: '26px',
            fontWeight: '700',
            color: '#111827',
            letterSpacing: '1px',
            marginBottom: '10px',
          }}
        >
          PROPERTY DAMAGE REPORT
        </div>
        <div
          style={{
            fontSize: '26px',
            fontWeight: '700',
            color: '#111827',
            letterSpacing: '1px',
          }}
        >
          STORM &amp; HAIL
        </div>
      </div>

      {/* Prepared by block */}
      <div style={{ textAlign: 'center', marginBottom: 'auto' }}>
        <div style={{ fontSize: '12px', fontWeight: '700', marginBottom: '10px', color: '#111827' }}>
          Prepared By:
        </div>
        <div style={{ fontSize: '11.5px', color: '#374151', lineHeight: '1.9' }}>
          <div>{report.assessor_name || '—'}</div>
          <div>{reportDate}</div>
          <div>{report.report_ref || '—'}</div>
          <div>{job.claim_number || '—'}</div>
          <div>{job.insured_name || '—'}</div>
          <div>{job.property_address || '—'}</div>
        </div>
      </div>

      {/* Footer line */}
      <div style={{ marginTop: '40px', paddingTop: '14px', borderTop: '1px solid #e5e7eb' }}>
        <div style={{ textAlign: 'center', fontSize: '10px', color: '#6b7280', marginBottom: '8px' }}>
          {tenant.contact_email || ''}
        </div>
        <div style={{ fontSize: '9px', color: '#9ca3af' }}>
          Version: {new Date().toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })}
        </div>
      </div>
    </div>
  )
}

// ——— Main report content ——————————————————————————————————————————
function ReportContent({ report, job, tenant }: { report: Report; job: Job; tenant: Tenant }) {
  const assessorName = report.assessor_name || '—'
  const companyName = tenant.trading_name || tenant.name || 'Insurance Repair Co Pty Ltd'
  const contactDetails = [assessorName, tenant.address, tenant.contact_email]
    .filter(Boolean)
    .join(', ')

  const reportDate = tsf(report, 'date_report_prepared')
    ? new Date(tsf(report, 'date_report_prepared')).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : new Date().toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const submissionDate = tsf(report, 'report_submission_date')
    ? new Date(tsf(report, 'report_submission_date')).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—'

  const siteVisitDate = formatDate(report.attendance_date)
  const reportRef = report.report_ref || '—'

  const aiUsed = tsf(report, 'ai_used')
  const aiStatement =
    aiUsed.toLowerCase() === 'yes'
      ? tsf(report, 'ai_statement') || 'Generative artificial intelligence was used to assist in generating the content of the expert\'s report.'
      : 'Generative artificial intelligence was not used to generate the content of the expert\'s report.'

  return (
    <div style={{ fontFamily: FONT, padding: '0 40px' }}>
      <SedgwickHeader />

      {/* Report title bar */}
      <div
        style={{
          background: HEADER_BG,
          border: BORDER,
          borderRadius: '3px',
          padding: '7px 12px',
          marginBottom: '16px',
          fontSize: '11px',
          fontWeight: '700',
          color: SECTION_TITLE_COLOR,
        }}
      >
        {reportRef} – {job.insurer || 'Allianz'} Property Damage Report - Storm &amp; Hail
      </div>

      {/* ─── Summary ─── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px', border: BORDER, fontSize: '10.5px' }}>
        <tbody>
          {/* Summary header */}
          <tr>
            <td
              colSpan={2}
              style={{
                background: HEADER_BG,
                padding: '5px 10px',
                fontSize: '11px',
                fontWeight: '700',
                borderBottom: BORDER,
                color: SECTION_TITLE_COLOR,
              }}
            >
              Summary
            </td>
          </tr>

          {/* Expert acknowledgment */}
          <tr>
            <td
              colSpan={2}
              style={{
                padding: CELL_PAD,
                borderBottom: BORDER,
              }}
            >
              <div style={{ fontWeight: '700', marginBottom: '6px', fontSize: '10.5px' }}>
                Expert&apos;s acknowledgment
              </div>
              <div style={{ fontSize: '10.5px', color: VALUE_COLOR, lineHeight: '1.6' }}>
                I, {assessorName}, employed by Insurance Repair Co Pty Ltd, have read, acknowledge and agree to be bound
                by Part 2, Format, paragraphs (a)(i) - (xi) the Insurance Council of Australia Use of Expert Reports:
                Industry Best Practice Standard (August 2024).
              </div>
            </td>
          </tr>

          {/* Introduction & Qualifications */}
          <tr>
            <td
              colSpan={2}
              style={{ padding: CELL_PAD, borderBottom: BORDER }}
            >
              <div style={{ fontWeight: '700', marginBottom: '6px', fontSize: '10.5px' }}>
                Introduction and Qualifications
              </div>
              <div style={{ fontSize: '10.5px', color: VALUE_COLOR, lineHeight: '1.9' }}>
                <div>Brief Qualifications Summary:</div>
                <div>{tsf(report, 'brief_qualifications') !== '—' ? tsf(report, 'brief_qualifications') : assessorName}</div>
                <div style={{ marginTop: '4px' }}>Qualifications of Subcontracted Experts:</div>
                <div>{tsf(report, 'subcontracted_experts') !== '—' ? tsf(report, 'subcontracted_experts') : ''}</div>
                <div style={{ marginTop: '4px' }}>CV Attachment:</div>
                <div>{tsf(report, 'cv_attachment') !== '—' ? tsf(report, 'cv_attachment') : 'CV Provided on Request'}</div>
              </div>
            </td>
          </tr>

          {/* Purpose & scope */}
          <tr>
            <td
              colSpan={2}
              style={{ padding: CELL_PAD, borderBottom: 'none' }}
            >
              <div style={{ fontWeight: '700', marginBottom: '6px', fontSize: '10.5px' }}>
                Purpose and Scope of Report
              </div>
              <div style={{ fontSize: '10.5px', color: VALUE_COLOR, lineHeight: '1.6', marginBottom: '8px' }}>
                This report is requested to assess the cause and impact of the storm and hail incident. It will be used
                to evaluate the claim and inform the customer of the findings.
              </div>
              <div style={{ fontSize: '10.5px', color: VALUE_COLOR, lineHeight: '1.6' }}>
                This report is limited to factual evidence based on my qualifications and area of expertise. The opinions
                I have expressed in this report are objective, and I have not been asked to provide recommendations on
                the outcome of the claim.
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* ─── Storm & Hail Damage Report ─── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px', border: BORDER, fontSize: '10.5px' }}>
        <tbody>
          <tr>
            <td
              colSpan={2}
              style={{
                background: HEADER_BG,
                padding: '5px 10px',
                fontSize: '11px',
                fontWeight: '700',
                borderBottom: BORDER,
                color: SECTION_TITLE_COLOR,
              }}
            >
              Storm &amp; Hail Damage Report
            </td>
          </tr>

          {/* Site Visit Details */}
          <KVRow label="Site Visit Details" value="" labelWidth="38%" />
          <KVRow label="Prepared By:" value={assessorName} />
          <KVRow label="Company:" value={companyName} />
          <KVRow label="Contact Details:" value={contactDetails} />
          <KVRow label="Date of Site Visit:" value={siteVisitDate} />
          <KVRow label="Parties present at Site Visit:" value={report.person_met || '—'} />
          <KVRow
            label="Site Visit Duration (Time In/Out):"
            value={tsf(report, 'site_visit_duration')}
          />
          <KVRow label="Date Report Prepared:" value={reportDate} />
          <KVRow label="Date of Report Submission:" value={submissionDate} />
          <KVRow label="Allianz Claim Number:" value={job.claim_number || '—'} />
        </tbody>
      </table>

      {/* ─── 1. Property Information ─── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px', border: BORDER, fontSize: '10.5px' }}>
        <tbody>
          <SectionBand title="1. Property Information" />
          <tr>
            <td colSpan={2} style={{ padding: '4px 10px', borderBottom: BORDER }}>
              <div style={{ fontSize: '10px', fontWeight: '700', color: LABEL_COLOR, marginBottom: '4px' }}>
                Property Details
              </div>
            </td>
          </tr>
          <KVRow label="Property Address:" value={job.property_address || '—'} />
          <KVRow label="Property Owner:" value={job.insured_name || '—'} />
          <KVRow label="Property Type:" value={tsf(report, 'property_type')} />
          <KVRow label="Contact Information:" value={tsf(report, 'property_contact')} />
          <SubHeadRow title="Property Description" />
          <TextRow text={report.property_description} />
        </tbody>
      </table>

      {/* ─── 2. Incident Description ─── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px', border: BORDER, fontSize: '10.5px' }}>
        <tbody>
          <SectionBand title="2. Incident Description" />
          <KVRow
            label="Date of Incident"
            value={
              tsf(report, 'incident_date') !== '—'
                ? formatDate(tsf(report, 'incident_date'))
                : '—'
            }
          />
          <KVRow label="Time of Incident" value={tsf(report, 'incident_time')} />
          <KVRow label="Brief Description of Incident" value={renderText(report.incident_description)} />
        </tbody>
      </table>

      {/* ─── 3. Conclusion ─── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px', border: BORDER, fontSize: '10.5px' }}>
        <tbody>
          <SectionBand title="3. Conclusion" />
          <KVRow label="Conclusion" value={renderText(report.conclusion)} />
        </tbody>
      </table>

      {/* ─── 4. Questions for Expert ─── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px', border: BORDER, fontSize: '10.5px' }}>
        <tbody>
          <SectionBand title="4. Questions for Expert" />
          <tr>
            <td
              colSpan={2}
              style={{
                padding: CELL_PAD,
                borderBottom: BORDER,
                fontSize: '10px',
                fontStyle: 'italic',
                color: '#6b7280',
                fontFamily: FONT,
              }}
            >
              I have been instructed to address the following questions
            </td>
          </tr>
          <KVRow
            label="What size and type of hailstones were present?"
            value={tsf(report, 'hailstone_size')}
          />
          <KVRow
            label="How has the damage occurred?"
            value={renderText(report.how_damage_occurred)}
          />
          <KVRow
            label="Were there any pre-existing vulnerabilities in the property that could have worsened the damage?"
            value={tsf(report, 'pre_existing_vulnerabilities')}
          />
          <KVRow
            label="Were there any trees or debris that contributed to the damage?"
            value={renderText(tsf(report, 'trees_debris_contribution') !== '—' ? tsf(report, 'trees_debris_contribution') : null)}
          />
          <KVRow
            label="What was the condition of the roofing and exterior structures before the storm?"
            value={tsf(report, 'roofing_condition_before')}
          />
          <KVRow
            label="Were there any preventive measures in place?"
            value={tsf(report, 'preventive_measures')}
          />
        </tbody>
      </table>

      {/* ─── 5. Additional Considerations ─── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px', border: BORDER, fontSize: '10.5px' }}>
        <tbody>
          <SectionBand title="5. Additional Considerations" />
          <KVRow
            label="Was there any evidence of wind-driven rain causing damage?"
            value={tsf(report, 'wind_driven_rain')}
          />
          <KVRow
            label="Were there any structural failures due to the storm?"
            value={tsf(report, 'structural_failures')}
          />
        </tbody>
      </table>

      {/* ─── 6. Supporting Evidence ─── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px', border: BORDER, fontSize: '10.5px' }}>
        <tbody>
          <SectionBand title="6. Supporting Evidence and Attachments" />
          <SubHeadRow title="Evidence Supplied by the Customer" />
          <TextRow text={tsf(report, 'customer_evidence') !== '—' ? tsf(report, 'customer_evidence') : 'N/A'} />
          <SubHeadRow title="Other Supporting Evidence" />
          <TextRow text={tsf(report, 'other_evidence') !== '—' ? tsf(report, 'other_evidence') : 'N/A'} />
        </tbody>
      </table>

      {/* ─── 7. General Observations ─── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px', border: BORDER, fontSize: '10.5px' }}>
        <tbody>
          <SectionBand title="7. General Observations" />
          <KVRow label="Details" value={renderText(report.resulting_damage)} />
        </tbody>
      </table>

      {/* ─── 8. Customer Vulnerabilities ─── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px', border: BORDER, fontSize: '10.5px' }}>
        <tbody>
          <SectionBand title="8. Consideration of Customer Vulnerabilities" />
          <KVRow
            label="Are there any applicable Customer Vulnerabilities"
            value={tsf(report, 'customer_vulnerabilities')}
          />
        </tbody>
      </table>

      {/* ─── 9. Further Investigation ─── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px', border: BORDER, fontSize: '10.5px' }}>
        <tbody>
          <SectionBand title="9. Further Investigation and Expert Input" />
          <KVRow
            label="Matters Requiring Further Investigation"
            value={tsf(report, 'further_investigation')}
          />
          <KVRow
            label="Need for Additional Expert Reports"
            value={tsf(report, 'additional_expert_reports')}
          />
          <KVRow
            label="Limitations of Expertise"
            value={tsf(report, 'limitations_of_expertise')}
          />
        </tbody>
      </table>

      {/* ─── 10. Generative Intelligence ─── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px', border: BORDER, fontSize: '10.5px' }}>
        <tbody>
          <SectionBand title="10. Generative Intelligence" />
          <KVRow
            label="Was Generative Intelligence used in this report?"
            value={aiUsed !== '—' ? aiUsed : 'No'}
          />
          <KVRow label="Generative Intelligence" value={aiStatement} />
        </tbody>
      </table>

      {/* Footer */}
      <div style={{ marginTop: '8px', paddingTop: '10px', borderTop: '1px solid #e5e7eb' }}>
        <div style={{ fontSize: '9px', color: '#9ca3af', fontFamily: FONT }}>
          Version: {new Date().toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })}
        </div>
      </div>
    </div>
  )
}

// ——— Photos section ——————————————————————————————————————————————
function PhotosSection({ photos }: { photos: Photo[] }) {
  if (!photos.length) return null
  const pages: Photo[][] = []
  for (let i = 0; i < photos.length; i += 6) pages.push(photos.slice(i, i + 6))

  return (
    <>
      {pages.map((pagePhotos, pageIdx) => (
        <div
          key={pageIdx}
          style={{
            pageBreakBefore: pageIdx === 0 ? 'always' : 'auto',
            padding: '0 40px',
            fontFamily: FONT,
          }}
        >
          {pageIdx === 0 && (
            <>
              <SedgwickHeader />
              <div style={{ fontSize: '11px', fontWeight: '700', color: SECTION_TITLE_COLOR, marginBottom: '12px', letterSpacing: '1px', textTransform: 'uppercase' }}>
                Photographs
              </div>
            </>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '24px' }}>
            {pagePhotos.map((photo, idx) => {
              const seq = pageIdx * 6 + idx + 1
              return (
                <div key={photo.id} style={{ breakInside: 'avoid' }}>
                  <div style={{ borderRadius: '4px', border: BORDER, marginBottom: '6px', overflow: 'hidden' }}>
                    <img
                      src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/photos/${photo.storage_path}?width=800&height=600`}
                      alt={photo.label || photo.file_name || 'Photo'}
                      style={{ width: '100%', maxHeight: 260, objectFit: 'contain', background: '#f3f4f6', display: 'block' }}
                    />
                  </div>
                  {photo.label && (
                    <div style={{ fontSize: '10px', color: '#374151', textAlign: 'center' }}>
                      {seq}. {photo.label}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )
}

// ——— Root export ——————————————————————————————————————————————————
export function AllianzSedgwickTemplate({ report, job, tenant, photos }: Props) {
  return (
    <div className="min-h-screen bg-white print:bg-white" style={{ fontFamily: FONT }}>
      <div className="max-w-4xl mx-auto bg-white shadow-lg print:shadow-none" style={{ fontFamily: FONT }}>
        {/* Cover page */}
        <CoverPage report={report} job={job} tenant={tenant} />

        {/* Main report content */}
        <ReportContent report={report} job={job} tenant={tenant} />

        {/* Photos */}
        <PhotosSection photos={photos} />
      </div>
    </div>
  )
}
