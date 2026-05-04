'use client'

import React, { useState } from 'react'
import { ReportPhotos } from './ReportPhotos'

interface LDRReportFormProps {
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

function FieldLabel({ label }: { label: string }) {
  return (
    <label
      className="block text-[10px] font-semibold tracking-[0.14em] uppercase text-[#b0a898] mb-1"
      style={{ fontFamily: 'DM Sans, sans-serif' }}
    >
      {label}
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

function DropdownSelect({
  value,
  onChange,
  locked,
  options,
}: {
  value: string
  onChange: (v: string) => void
  locked: boolean
  options: string[]
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={locked}
      className={`
        w-full px-3 py-2 rounded-md border text-[13px] text-[#3a3530] bg-white
        border-[#e4dfd8] focus:outline-none focus:border-[#c8b89a] focus:ring-1 focus:ring-[#c8b89a]
        disabled:bg-[#f9f7f5] disabled:text-[#b0a898] disabled:cursor-not-allowed
        transition-colors appearance-none cursor-pointer
      `}
      style={{ fontFamily: 'DM Sans, sans-serif' }}
    >
      <option value="">— Select —</option>
      {options.map(opt => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
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

export function LDRReportForm({ data, locked, onChange, tenantId, reportId, jobId }: LDRReportFormProps) {
  const [generating, setGenerating] = useState(false)
  const str = (key: string) => String(data[key] ?? '')
  const tsf = (key: string) => {
    const fields = data.type_specific_fields as Record<string, unknown> | null
    if (!fields) return ''
    const val = fields[key]
    if (val === null || val === undefined || val === '') return ''
    return String(val)
  }

  async function handleGenerateReport() {
    const rawDump = str('raw_report_dump')
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
        body: JSON.stringify({
          rawReportDump: rawDump,
          reportType: 'LDR',
          tenantId,
        }),
      })

      const result = await res.json()
      if (!res.ok) {
        throw new Error(result.error || 'Failed to generate report')
      }

      // Populate form fields with AI response
      Object.entries(result.reportData).forEach(([key, value]) => {
        if (value && typeof value === 'string') {
          onChange(key, value)
        }
      })
    } catch (error) {
      console.error('Error generating report:', error)
      alert('Failed to generate report. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  const handleTsfChange = (key: string, value: string) => {
    const current = (data.type_specific_fields as Record<string, unknown>) || {}
    onChange('type_specific_fields', { ...current, [key]: value })
  }

  return (
    <div>
      {/* — RAW NOTES — */}
      <SectionHeading label="Field Notes (Internal)" />
      <div>
        <div className="flex items-center justify-between mb-1">
          <FieldLabel label="Raw Report Dump" />
          <button
            type="button"
            onClick={handleGenerateReport}
            disabled={locked || generating || !str('raw_report_dump').trim()}
            className={`
              px-3 py-1.5 rounded-md text-[11px] font-semibold tracking-[0.1em] uppercase
              transition-all duration-200
              ${locked || generating || !str('raw_report_dump').trim()
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
          value={str('raw_report_dump')}
          onChange={v => onChange('raw_report_dump', v)}
          locked={locked}
          placeholder="Raw dictation or field notes used to generate this report (internal only, not included in PDF)..."
          rows={4}
        />
      </div>

      {/* — ATTENDANCE — */}
      <SectionHeading label="Attendance" />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel label="Date of Attendance" />
          <InlineInput
            type="date"
            value={str('attendance_date')}
            onChange={v => onChange('attendance_date', v)}
            locked={locked}
          />
        </div>
        <div>
          <FieldLabel label="Time of Attendance" />
          <InlineInput
            type="time"
            value={str('attendance_time')}
            onChange={v => onChange('attendance_time', v)}
            locked={locked}
          />
        </div>
        <div>
          <FieldLabel label="Person Met" />
          <InlineInput
            value={str('person_met')}
            onChange={v => onChange('person_met', v)}
            locked={locked}
            placeholder="e.g. John Smith (Owner)"
          />
        </div>
        <div>
          <FieldLabel label="Conducted by" />
          <InlineInput
            value={str('assessor_name')}
            onChange={v => onChange('assessor_name', v)}
            locked={locked}
            placeholder="e.g. Kyle Bindon"
          />
        </div>
      </div>

      {/* — LEAK DETAILS — */}
      <SectionHeading label="Leak Details" />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel label="Leak Location" />
          <InlineInput
            value={tsf('leak_location')}
            onChange={v => handleTsfChange('leak_location', v)}
            locked={locked}
            placeholder="e.g. Bathroom ceiling, Kitchen wall"
          />
        </div>
        <div>
          <FieldLabel label="Leak Source" />
          <InlineInput
            value={tsf('leak_source')}
            onChange={v => handleTsfChange('leak_source', v)}
            locked={locked}
            placeholder="e.g. Roof, Plumbing, Shower base"
          />
        </div>
        <div>
          <FieldLabel label="Water Type" />
          <InlineInput
            value={tsf('water_type')}
            onChange={v => handleTsfChange('water_type', v)}
            locked={locked}
            placeholder="e.g. Rainwater, Greywater, Sewage"
          />
        </div>
        <div>
          <FieldLabel label="Duration of Leak" />
          <InlineInput
            value={tsf('leak_duration')}
            onChange={v => handleTsfChange('leak_duration', v)}
            locked={locked}
            placeholder="e.g. 2 days, 1 week, Ongoing"
          />
        </div>
      </div>

      {/* — PRESSURE TESTS — */}
      <SectionHeading label="Pressure Tests & Inspections" />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel label="Shower Breach pressure test" />
          <DropdownSelect
            value={tsf('shower_breach_test')}
            onChange={v => handleTsfChange('shower_breach_test', v)}
            locked={locked}
            options={['PASS', 'FAIL', 'N/A']}
          />
        </div>
        <div>
          <FieldLabel label="Cold Water line pressure test" />
          <DropdownSelect
            value={tsf('cold_water_test')}
            onChange={v => handleTsfChange('cold_water_test', v)}
            locked={locked}
            options={['PASS', 'FAIL', 'N/A']}
          />
        </div>
        <div>
          <FieldLabel label="Hot water line pressure test" />
          <DropdownSelect
            value={tsf('hot_water_test')}
            onChange={v => handleTsfChange('hot_water_test', v)}
            locked={locked}
            options={['PASS', 'FAIL', 'N/A']}
          />
        </div>
        <div>
          <FieldLabel label="Flood test to shower base" />
          <DropdownSelect
            value={tsf('shower_flood_test')}
            onChange={v => handleTsfChange('shower_flood_test', v)}
            locked={locked}
            options={['PASS', 'FAIL', 'N/A']}
          />
        </div>
        <div>
          <FieldLabel label="Spray test to shower walls &amp; screen" />
          <DropdownSelect
            value={tsf('shower_spray_test')}
            onChange={v => handleTsfChange('shower_spray_test', v)}
            locked={locked}
            options={['PASS', 'FAIL', 'N/A']}
          />
        </div>
        <div>
          <FieldLabel label="Visual inspection to tiles, grout &amp; silicone" />
          <DropdownSelect
            value={tsf('tiles_grout_test')}
            onChange={v => handleTsfChange('tiles_grout_test', v)}
            locked={locked}
            options={['PASS', 'FAIL', 'N/A']}
          />
        </div>
        <div>
          <FieldLabel label="Inspection to flexi-hose" />
          <DropdownSelect
            value={tsf('flexi_hose_test')}
            onChange={v => handleTsfChange('flexi_hose_test', v)}
            locked={locked}
            options={['PASS', 'FAIL', 'N/A']}
          />
        </div>
        <div>
          <FieldLabel label="Inspection to water pipe (shower, bath, vanity/kitchen)" />
          <DropdownSelect
            value={tsf('water_pipe_test')}
            onChange={v => handleTsfChange('water_pipe_test', v)}
            locked={locked}
            options={['PASS', 'FAIL', 'N/A']}
          />
        </div>
        <div>
          <FieldLabel label="Inspection of toilet pan/cistern" />
          <DropdownSelect
            value={tsf('toilet_test')}
            onChange={v => handleTsfChange('toilet_test', v)}
            locked={locked}
            options={['PASS', 'FAIL', 'N/A']}
          />
        </div>
        <div>
          <FieldLabel label="Thermal Imaging" />
          <DropdownSelect
            value={tsf('thermal_imaging_test')}
            onChange={v => handleTsfChange('thermal_imaging_test', v)}
            locked={locked}
            options={['PASS', 'FAIL', 'N/A']}
          />
        </div>
      </div>

      {/* — INVESTIGATION & FINDINGS — */}
      <SectionHeading label="Investigation and Findings" />
      <div className="space-y-4">
        <div>
          <FieldLabel label="Investigation and Findings" />
          <InlineTextarea
            value={tsf('investigation_findings')}
            onChange={v => handleTsfChange('investigation_findings', v)}
            locked={locked}
            placeholder="Describe the investigation methods used and detail the findings from the investigation..."
            rows={6}
          />
        </div>
      </div>

      {/* — DAMAGE ASSESSMENT — */}
      <SectionHeading label="Damage Assessment" />
      <div className="space-y-4">
        <div>
          <FieldLabel label="Affected Areas" />
          <InlineTextarea
            value={tsf('affected_areas')}
            onChange={v => handleTsfChange('affected_areas', v)}
            locked={locked}
            placeholder="List all areas affected by the leak..."
            rows={3}
          />
        </div>
        <div>
          <FieldLabel label="Pre-Existing Conditions" />
          <InlineTextarea
            value={str('pre_existing_conditions')}
            onChange={v => onChange('pre_existing_conditions', v)}
            locked={locked}
            placeholder="Note any pre-existing damage or conditions unrelated to the leak..."
            rows={3}
          />
        </div>
      </div>

      {/* — RECOMMENDATIONS — */}
      <SectionHeading label="Recommendations" />
      <div className="space-y-4">
        <div>
          <FieldLabel label="Repair Recommendations" />
          <InlineTextarea
            value={tsf('repair_recommendations')}
            onChange={v => handleTsfChange('repair_recommendations', v)}
            locked={locked}
            placeholder="Detail recommended repairs to address the leak..."
            rows={4}
          />
        </div>
        <div>
          <FieldLabel label="Further investigation by plumber required" />
          <InlineInput
            value={tsf('further_investigation_plumber')}
            onChange={v => handleTsfChange('further_investigation_plumber', v)}
            locked={locked}
            placeholder="e.g. Yes, No, N/A"
          />
        </div>
      </div>

      {/* — CONCLUSION — */}
      <SectionHeading label="Conclusion" />
      <div>
        <FieldLabel label="Conclusion" />
        <InlineTextarea
          value={str('conclusion')}
          onChange={v => onChange('conclusion', v)}
          locked={locked}
          placeholder="State your professional opinion and conclusions regarding the leak..."
          rows={5}
        />
      </div>

      {/* — ADDITIONAL NOTES — */}
      <SectionHeading label="Additional Notes" />
      <div>
        <FieldLabel label="Additional Notes" />
        <InlineTextarea
          value={str('additional_notes')}
          onChange={v => onChange('additional_notes', v)}
          locked={locked}
          placeholder="Any additional notes or comments..."
          rows={3}
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
