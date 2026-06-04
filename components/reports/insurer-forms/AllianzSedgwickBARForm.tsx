'use client'

import { useState } from 'react'
import { ReportPhotos } from '../ReportPhotos'

interface AllianzSedgwickBARFormProps {
  data: Record<string, unknown>
  locked: boolean
  onChange: (field: string, value: unknown) => void
  tenantId?: string
  reportId?: string
  jobId?: string
}

function SectionHeading({ label }: { label: string }) {
  return (
    <div className="mt-8 mb-4">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-[#e4dfd8]" />
        <span
          className="text-[10px] font-semibold tracking-[0.18em] uppercase text-[#c8b89a]"
          style={{ fontFamily: 'DM Sans, sans-serif' }}
        >
          {label}
        </span>
        <div className="h-px flex-1 bg-[#e4dfd8]" />
      </div>
    </div>
  )
}

function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <label
      className="block text-[10px] font-semibold tracking-[0.14em] uppercase text-[#b0a898] mb-1"
      style={{ fontFamily: 'DM Sans, sans-serif' }}
    >
      {label}
      {hint && (
        <span className="ml-1 normal-case tracking-normal text-[#c8bfb4]">{hint}</span>
      )}
    </label>
  )
}

function InlineInput({
  value,
  onChange,
  locked,
  placeholder,
  type = 'text',
}: {
  value: string
  onChange: (v: string) => void
  locked: boolean
  placeholder?: string
  type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={locked}
      placeholder={placeholder}
      className={`
        w-full px-3 py-2 rounded-md border text-[13px] text-[#3a3530] bg-white
        border-[#e4dfd8] focus:outline-none focus:border-[#c8b89a] focus:ring-1 focus:ring-[#c8b89a]
        disabled:bg-[#f9f7f5] disabled:text-[#b0a898] disabled:cursor-not-allowed
        transition-colors
      `}
      style={{ fontFamily: 'DM Sans, sans-serif' }}
    />
  )
}

function InlineTextarea({
  value,
  onChange,
  locked,
  placeholder,
  rows = 3,
}: {
  value: string
  onChange: (v: string) => void
  locked: boolean
  placeholder?: string
  rows?: number
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={locked}
      placeholder={placeholder}
      rows={rows}
      className={`
        w-full px-3 py-2 rounded-md border text-[13px] text-[#3a3530] bg-white
        border-[#e4dfd8] focus:outline-none focus:border-[#c8b89a] focus:ring-1 focus:ring-[#c8b89a]
        disabled:bg-[#f9f7f5] disabled:text-[#b0a898] disabled:cursor-not-allowed
        resize-y transition-colors
      `}
      style={{ fontFamily: 'DM Sans, sans-serif' }}
    />
  )
}

export function AllianzSedgwickBARForm({
  data,
  locked,
  onChange,
  tenantId,
  reportId,
  jobId,
}: AllianzSedgwickBARFormProps) {
  const [generating, setGenerating] = useState(false)

  const str = (key: string) => String(data[key] ?? '')

  const tsf = (key: string) => {
    const fields = data.type_specific_fields as Record<string, unknown> | null
    if (!fields) return ''
    const val = fields[key]
    if (val === null || val === undefined || val === '') return ''
    return String(val)
  }

  const setTsf = (key: string, val: string) => {
    const existing = (data.type_specific_fields as Record<string, unknown>) ?? {}
    onChange('type_specific_fields', { ...existing, [key]: val })
  }

  async function handleGenerateReport() {
    const rawDump = str('raw_report_notes')
    if (!rawDump.trim()) {
      alert('Please enter some raw notes first')
      return
    }
    if (!tenantId) {
      alert('Tenant ID is required')
      return
    }
    setGenerating(true)
    try {
      const res = await fetch('/api/ai/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawReportDump: rawDump, reportType: 'BAR', tenantId }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to generate report')
      Object.entries(result.reportData).forEach(([key, value]) => {
        if (value && typeof value === 'string') onChange(key, value)
      })
    } catch (error) {
      console.error('Error generating report:', error)
      alert('Failed to generate report. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div>
      {/* — RAW NOTES — */}
      <SectionHeading label="Field Notes (Internal)" />
      <div>
        <div className="flex items-center justify-between mb-1">
          <FieldLabel label="Raw Report Notes" />
          <button
            type="button"
            onClick={handleGenerateReport}
            disabled={locked || generating || !str('raw_report_notes').trim()}
            className={`
              px-3 py-1.5 rounded-md text-[11px] font-semibold tracking-[0.1em] uppercase
              transition-all duration-200
              ${locked || generating || !str('raw_report_notes').trim()
                ? 'bg-[#f5f0e8] text-[#b0a898] cursor-not-allowed'
                : 'bg-[#1a1a1a] text-[#f5f0e8] hover:bg-[#2a2a2a] cursor-pointer'
              }
            `}
            style={{ fontFamily: 'DM Sans, sans-serif' }}
          >
            {generating ? 'Generating...' : 'AI Generate'}
          </button>
        </div>
        <InlineTextarea
          value={str('raw_report_notes')}
          onChange={v => onChange('raw_report_notes', v)}
          locked={locked}
          placeholder="Raw dictation or field notes (internal only, not included in PDF)..."
          rows={4}
        />
      </div>

      {/* — QUALIFICATIONS (Summary section) — */}
      <SectionHeading label="Qualifications & Acknowledgment" />
      <div className="space-y-4">
        <div>
          <FieldLabel label="Brief Qualifications Summary" />
          <InlineInput
            value={tsf('brief_qualifications')}
            onChange={v => setTsf('brief_qualifications', v)}
            locked={locked}
            placeholder="e.g. Kyle Bindon"
          />
        </div>
        <div>
          <FieldLabel label="Qualifications of Subcontracted Experts" />
          <InlineInput
            value={tsf('subcontracted_experts')}
            onChange={v => setTsf('subcontracted_experts', v)}
            locked={locked}
            placeholder="Leave blank if none"
          />
        </div>
        <div>
          <FieldLabel label="CV Attachment" />
          <InlineInput
            value={tsf('cv_attachment') || 'CV Provided on Request'}
            onChange={v => setTsf('cv_attachment', v)}
            locked={locked}
            placeholder="CV Provided on Request"
          />
        </div>
      </div>

      {/* — SITE VISIT DETAILS — */}
      <SectionHeading label="Site Visit Details" />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel label="Date of Site Visit" />
          <InlineInput
            type="date"
            value={str('attendance_date')}
            onChange={v => onChange('attendance_date', v)}
            locked={locked}
          />
        </div>
        <div>
          <FieldLabel label="Site Visit Duration (Time In/Out)" />
          <InlineInput
            value={tsf('site_visit_duration')}
            onChange={v => setTsf('site_visit_duration', v)}
            locked={locked}
            placeholder="e.g. 1pm - 1:30pm"
          />
        </div>
        <div>
          <FieldLabel label="Prepared By (Assessor Name)" />
          <InlineInput
            value={str('assessor_name')}
            onChange={v => onChange('assessor_name', v)}
            locked={locked}
            placeholder="e.g. Kyle Bindon"
          />
        </div>
        <div>
          <FieldLabel label="Parties Present at Site Visit" />
          <InlineInput
            value={str('person_met')}
            onChange={v => onChange('person_met', v)}
            locked={locked}
            placeholder="e.g. Kyle Bindon, Heather Wilkie"
          />
        </div>
        <div>
          <FieldLabel label="Date Report Prepared" />
          <InlineInput
            type="date"
            value={tsf('date_report_prepared')}
            onChange={v => setTsf('date_report_prepared', v)}
            locked={locked}
          />
        </div>
        <div>
          <FieldLabel label="Date of Report Submission" />
          <InlineInput
            type="date"
            value={tsf('report_submission_date')}
            onChange={v => setTsf('report_submission_date', v)}
            locked={locked}
          />
        </div>
      </div>

      {/* — PROPERTY INFORMATION — */}
      <SectionHeading label="1. Property Information" />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel label="Property Type" />
          <InlineInput
            value={tsf('property_type')}
            onChange={v => setTsf('property_type', v)}
            locked={locked}
            placeholder="e.g. detached house, unit"
          />
        </div>
        <div>
          <FieldLabel label="Owner Contact Information" hint="(phone, email)" />
          <InlineInput
            value={tsf('property_contact')}
            onChange={v => setTsf('property_contact', v)}
            locked={locked}
            placeholder="e.g. 0400 000 000, email@example.com"
          />
        </div>
      </div>
      <div className="mt-4">
        <FieldLabel label="Property Description" />
        <InlineTextarea
          value={str('property_description')}
          onChange={v => onChange('property_description', v)}
          locked={locked}
          placeholder="Describe the property construction, age, roof, etc..."
          rows={3}
        />
      </div>

      {/* — INCIDENT DESCRIPTION — */}
      <SectionHeading label="2. Incident Description" />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel label="Date of Incident" />
          <InlineInput
            type="date"
            value={tsf('incident_date')}
            onChange={v => setTsf('incident_date', v)}
            locked={locked}
          />
        </div>
        <div>
          <FieldLabel label="Time of Incident" />
          <InlineInput
            value={tsf('incident_time')}
            onChange={v => setTsf('incident_time', v)}
            locked={locked}
            placeholder="e.g. 3:18 pm"
          />
        </div>
      </div>
      <div className="mt-4">
        <FieldLabel label="Brief Description of Incident" />
        <InlineTextarea
          value={str('incident_description')}
          onChange={v => onChange('incident_description', v)}
          locked={locked}
          placeholder="Describe what occurred during the incident..."
          rows={4}
        />
      </div>

      {/* — CONCLUSION — */}
      <SectionHeading label="3. Conclusion" />
      <div>
        <FieldLabel label="Conclusion" />
        <InlineTextarea
          value={str('conclusion')}
          onChange={v => onChange('conclusion', v)}
          locked={locked}
          placeholder="State your professional opinion and conclusions regarding the claim..."
          rows={5}
        />
      </div>

      {/* — QUESTIONS FOR EXPERT — */}
      <SectionHeading label="4. Questions for Expert" />
      <div className="space-y-4">
        <div>
          <FieldLabel label="What size and type of hailstones were present?" />
          <InlineInput
            value={tsf('hailstone_size')}
            onChange={v => setTsf('hailstone_size', v)}
            locked={locked}
            placeholder="e.g. N/A, 25mm irregular"
          />
        </div>
        <div>
          <FieldLabel label="How has the damage occurred?" />
          <InlineTextarea
            value={str('how_damage_occurred')}
            onChange={v => onChange('how_damage_occurred', v)}
            locked={locked}
            placeholder="Describe the mechanism of damage..."
            rows={3}
          />
        </div>
        <div>
          <FieldLabel label="Were there any pre-existing vulnerabilities that could have worsened the damage?" />
          <InlineInput
            value={tsf('pre_existing_vulnerabilities')}
            onChange={v => setTsf('pre_existing_vulnerabilities', v)}
            locked={locked}
            placeholder="e.g. No, Yes – describe"
          />
        </div>
        <div>
          <FieldLabel label="Were there any trees or debris that contributed to the damage?" />
          <InlineTextarea
            value={tsf('trees_debris_contribution')}
            onChange={v => setTsf('trees_debris_contribution', v)}
            locked={locked}
            placeholder="e.g. Yes - roof report states debris obstructed gutters..."
            rows={2}
          />
        </div>
        <div>
          <FieldLabel label="What was the condition of the roofing and exterior structures before the storm?" />
          <InlineInput
            value={tsf('roofing_condition_before')}
            onChange={v => setTsf('roofing_condition_before', v)}
            locked={locked}
            placeholder="e.g. Excellent, Good, Fair"
          />
        </div>
        <div>
          <FieldLabel label="Were there any preventive measures in place?" />
          <InlineInput
            value={tsf('preventive_measures')}
            onChange={v => setTsf('preventive_measures', v)}
            locked={locked}
            placeholder="e.g. No, Yes – describe"
          />
        </div>
      </div>

      {/* — ADDITIONAL CONSIDERATIONS — */}
      <SectionHeading label="5. Additional Considerations" />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel label="Was there any evidence of wind-driven rain causing damage?" />
          <InlineInput
            value={tsf('wind_driven_rain')}
            onChange={v => setTsf('wind_driven_rain', v)}
            locked={locked}
            placeholder="e.g. No, Yes"
          />
        </div>
        <div>
          <FieldLabel label="Were there any structural failures due to the storm?" />
          <InlineInput
            value={tsf('structural_failures')}
            onChange={v => setTsf('structural_failures', v)}
            locked={locked}
            placeholder="e.g. No, Yes"
          />
        </div>
      </div>

      {/* — SUPPORTING EVIDENCE — */}
      <SectionHeading label="6. Supporting Evidence and Attachments" />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel label="Evidence Supplied by the Customer" />
          <InlineInput
            value={tsf('customer_evidence')}
            onChange={v => setTsf('customer_evidence', v)}
            locked={locked}
            placeholder="e.g. N/A, Photos provided"
          />
        </div>
        <div>
          <FieldLabel label="Other Supporting Evidence" />
          <InlineInput
            value={tsf('other_evidence')}
            onChange={v => setTsf('other_evidence', v)}
            locked={locked}
            placeholder="e.g. N/A, BOM weather data"
          />
        </div>
      </div>

      {/* — GENERAL OBSERVATIONS — */}
      <SectionHeading label="7. General Observations" />
      <div>
        <FieldLabel label="Observations During Inspection" />
        <InlineTextarea
          value={str('resulting_damage')}
          onChange={v => onChange('resulting_damage', v)}
          locked={locked}
          placeholder="List all damage and observations noted during inspection (use bullet points)..."
          rows={6}
        />
      </div>

      {/* — CUSTOMER VULNERABILITIES — */}
      <SectionHeading label="8. Consideration of Customer Vulnerabilities" />
      <div>
        <FieldLabel label="Are there any applicable Customer Vulnerabilities?" />
        <InlineInput
          value={tsf('customer_vulnerabilities')}
          onChange={v => setTsf('customer_vulnerabilities', v)}
          locked={locked}
          placeholder="e.g. No, Yes – describe"
        />
      </div>

      {/* — FURTHER INVESTIGATION — */}
      <SectionHeading label="9. Further Investigation and Expert Input" />
      <div className="space-y-4">
        <div>
          <FieldLabel label="Matters Requiring Further Investigation" />
          <InlineInput
            value={tsf('further_investigation')}
            onChange={v => setTsf('further_investigation', v)}
            locked={locked}
            placeholder="e.g. N/A"
          />
        </div>
        <div>
          <FieldLabel label="Need for Additional Expert Reports" />
          <InlineInput
            value={tsf('additional_expert_reports')}
            onChange={v => setTsf('additional_expert_reports', v)}
            locked={locked}
            placeholder="e.g. Roof report, N/A"
          />
        </div>
        <div>
          <FieldLabel label="Limitations of Expertise" />
          <InlineInput
            value={tsf('limitations_of_expertise')}
            onChange={v => setTsf('limitations_of_expertise', v)}
            locked={locked}
            placeholder="e.g. N/A"
          />
        </div>
      </div>

      {/* — GENERATIVE INTELLIGENCE — */}
      <SectionHeading label="10. Generative Intelligence" />
      <div>
        <FieldLabel label="Was Generative Intelligence used in this report?" />
        <InlineInput
          value={tsf('ai_used')}
          onChange={v => setTsf('ai_used', v)}
          locked={locked}
          placeholder="e.g. No, Yes"
        />
      </div>

      {/* — PHOTOS — */}
      {reportId && jobId && tenantId && (
        <>
          <SectionHeading label="Photos" />
          <ReportPhotos
            reportId={reportId}
            jobId={jobId}
            tenantId={tenantId}
            locked={locked}
          />
        </>
      )}
    </div>
  )
}
