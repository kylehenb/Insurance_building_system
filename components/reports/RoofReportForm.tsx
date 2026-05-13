'use client'

import React, { useState, useEffect } from 'react'
import { ReportPhotos } from './ReportPhotos'

interface RoofReportFormProps {
  data: Record<string, unknown>
  locked: boolean
  onChange: (field: string, value: unknown) => void
  tenantId?: string
  reportId?: string
  jobId?: string
}

function SectionHeading({ label, subtitle }: { label: string; subtitle?: string }) {
  return (
    <div className="mt-8 mb-4">
      <div className="flex items-center gap-3 mb-1">
        <div className="h-px flex-1 bg-[#e4dfd8]" />
        <span
          className="text-[10px] font-semibold tracking-[0.18em] uppercase text-[#c8b89a]"
          style={{ fontFamily: 'DM Sans, sans-serif' }}
        >
          {label}
        </span>
        <div className="h-px flex-1 bg-[#e4dfd8]" />
      </div>
      {subtitle && (
        <p
          className="text-center text-[11px] text-[#b0a898] mt-1"
          style={{ fontFamily: 'DM Mono, monospace' }}
        >
          {subtitle}
        </p>
      )}
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
  defaultValue = '',
}: {
  value: string
  onChange: (v: string) => void
  locked: boolean
  placeholder?: string
  type?: string
  defaultValue?: string
}) {
  const [localValue, setLocalValue] = useState(value || defaultValue)

  useEffect(() => {
    if (value) {
      setLocalValue(value)
    }
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setLocalValue(newValue)
    onChange(newValue)
  }

  return (
    <input
      type={type}
      value={localValue}
      onChange={handleChange}
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
  defaultValue = '',
}: {
  value: string
  onChange: (v: string) => void
  locked: boolean
  placeholder?: string
  rows?: number
  defaultValue?: string
}) {
  const [localValue, setLocalValue] = useState(value || defaultValue)

  useEffect(() => {
    if (value) {
      setLocalValue(value)
    }
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    setLocalValue(newValue)
    onChange(newValue)
  }

  return (
    <textarea
      value={localValue}
      onChange={handleChange}
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

function DropdownSelect({
  value,
  onChange,
  locked,
  options,
  placeholder,
  defaultValue = '',
}: {
  value: string
  onChange: (v: string) => void
  locked: boolean
  options: string[]
  placeholder?: string
  defaultValue?: string
}) {
  const [localValue, setLocalValue] = useState(value || defaultValue)

  useEffect(() => {
    if (value) {
      setLocalValue(value)
    }
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = e.target.value
    setLocalValue(newValue)
    onChange(newValue)
  }

  return (
    <select
      value={localValue}
      onChange={handleChange}
      disabled={locked}
      className={`
        w-full px-3 py-2 rounded-md border text-[13px] text-[#3a3530] bg-white
        border-[#e4dfd8] focus:outline-none focus:border-[#c8b89a] focus:ring-1 focus:ring-[#c8b89a]
        disabled:bg-[#f9f7f5] disabled:text-[#b0a898] disabled:cursor-not-allowed
        transition-colors
      `}
      style={{ fontFamily: 'DM Sans, sans-serif' }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(opt => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  )
}

function MultiSelectDropdown({
  value,
  onChange,
  locked,
  options,
  placeholder,
}: {
  value: string[]
  onChange: (v: string[]) => void
  locked: boolean
  options: string[]
  placeholder?: string
}) {
  const [isOpen, setIsOpen] = useState(false)

  const toggleOption = (option: string) => {
    if (value.includes(option)) {
      onChange(value.filter(v => v !== option))
    } else {
      onChange([...value, option])
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => !locked && setIsOpen(!isOpen)}
        disabled={locked}
        className={`
          w-full px-3 py-2 rounded-md border text-[13px] text-left
          border-[#e4dfd8] focus:outline-none focus:border-[#c8b89a] focus:ring-1 focus:ring-[#c8b89a]
          disabled:bg-[#f9f7f5] disabled:text-[#b0a898] disabled:cursor-not-allowed
          transition-colors
        `}
        style={{ fontFamily: 'DM Sans, sans-serif' }}
      >
        {value.length > 0 ? value.join(', ') : (placeholder || 'Select options...')}
      </button>
      {isOpen && !locked && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-[#e4dfd8] rounded-md shadow-lg max-h-60 overflow-auto">
          {options.map(option => (
            <label
              key={option}
              className="flex items-center px-3 py-2 hover:bg-[#f5f2ee] cursor-pointer text-[13px]"
              style={{ fontFamily: 'DM Sans, sans-serif' }}
            >
              <input
                type="checkbox"
                checked={value.includes(option)}
                onChange={() => toggleOption(option)}
                className="mr-2 accent-[#c8b89a]"
              />
              {option}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

export function RoofReportForm({ data, locked, onChange, tenantId, reportId, jobId }: RoofReportFormProps) {
  const [generating, setGenerating] = useState(false)
  const str = (key: string) => String(data[key] ?? '')
  const tsf = (key: string) => {
    const tsFields = (data.type_specific_fields as Record<string, unknown>) ?? {}
    return String(tsFields[key] ?? '')
  }
  const tsfArray = (key: string): string[] => {
    const tsFields = (data.type_specific_fields as Record<string, unknown>) ?? {}
    const val = tsFields[key]
    if (Array.isArray(val)) return val as string[]
    if (typeof val === 'string' && val) return val.split(',').map(v => v.trim())
    return []
  }
  const onTsf = (key: string, value: string) => {
    const tsFields = (data.type_specific_fields as Record<string, unknown>) ?? {}
    onChange('type_specific_fields', { ...tsFields, [key]: value })
  }
  const onTsfArray = (key: string, value: string[]) => {
    const tsFields = (data.type_specific_fields as Record<string, unknown>) ?? {}
    onChange('type_specific_fields', { ...tsFields, [key]: value })
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
        body: JSON.stringify({
          rawReportDump: rawDump,
          reportType: 'roof',
          tenantId,
        }),
      })

      const result = await res.json()
      if (!res.ok) {
        throw new Error(result.error || 'Failed to generate report')
      }

      // Populate form fields with AI response
      // Handle regular fields
      Object.entries(result.reportData).forEach(([key, value]) => {
        if (value && typeof value === 'string') {
          // Check if this is a type_specific_fields key for roof reports
          const roofSpecificKeys = [
            'scope_of_report', 'roof_type', 'roof_general_condition', 'pitch_degrees',
            'number_of_penetrations', 'number_of_storeys', 'ridge_hip_condition',
            'gutter_condition', 'gutter_overflows', 'roof_insulation', 'specific_cause_of_damage',
            'internal_damage', 'roof_damage', 'damage_caused_by_maintenance',
            'non_claim_maintenance_issues', 'maintenance_repairs_required',
            'conditions_preventing_repairs', 'prior_repairs', 'conclusion'
          ]
          
          if (roofSpecificKeys.includes(key)) {
            // This goes in type_specific_fields
            const tsFields = (data.type_specific_fields as Record<string, unknown>) ?? {}
            onChange('type_specific_fields', { ...tsFields, [key]: value })
          } else {
            // This is a regular field
            onChange(key, value)
          }
        }
      })
    } catch (error) {
      console.error('Error generating report:', error)
      alert('Failed to generate report. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  const roofTypeOptions = [
    'Metal',
    'Concrete tile',
    'Terracotta tile',
    'Metal and concrete tile',
    'Metal and terracotta tile',
    'Asbestos sheet',
    'Insulated panel',
    'Decramastic roof tile',
    'Sheet membrane',
    'Other',
  ]

  const roofInsulationOptions = [
    'Anticon (foil backed blanket)',
    'Sarking/WRB',
    'Insulated panel',
    'Air cell',
    'None',
    'Other',
  ]

  return (
    <div>
      {/* — FIELD NOTES — */}
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
          placeholder="Raw dictation or field notes used to generate this report (internal only, not included in PDF)..."
          rows={4}
        />
      </div>

      {/* — ROOF REPORT DETAILS — */}
      <SectionHeading label="Roof Report Details" />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel label="Attendance Date" />
          <InlineInput
            type="date"
            value={str('attendance_date')}
            onChange={v => onChange('attendance_date', v)}
            locked={locked}
          />
        </div>
        <div>
          <FieldLabel label="Attendance Time" />
          <InlineInput
            type="time"
            value={str('attendance_time')}
            onChange={v => onChange('attendance_time', v)}
            locked={locked}
          />
        </div>
        <div className="col-span-2">
          <FieldLabel label="Roofer's Name & Qualifications" />
          <InlineInput
            value={str('assessor_name')}
            onChange={v => onChange('assessor_name', v)}
            locked={locked}
            defaultValue="Kyle B - Roof plumber, Registered Builder"
          />
        </div>
      </div>
      <div className="mt-4">
        <FieldLabel label="Scope of Roof Report" />
        <InlineTextarea
          value={tsf('scope_of_report')}
          onChange={v => onTsf('scope_of_report', v)}
          locked={locked}
          defaultValue="Carry out a roof inspection and provide a report relating to the claim."
          rows={3}
        />
      </div>

      {/* — ROOF DETAILS — */}
      <SectionHeading label="Roof Details" />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel label="Roof Type" />
          <MultiSelectDropdown
            value={tsfArray('roof_type')}
            onChange={v => onTsfArray('roof_type', v)}
            locked={locked}
            options={roofTypeOptions}
            placeholder="Select roof type(s)..."
          />
        </div>
        <div>
          <FieldLabel label="General Condition of Roof" />
          <DropdownSelect
            value={tsf('roof_general_condition')}
            onChange={v => onTsf('roof_general_condition', v)}
            locked={locked}
            options={['Good', 'Fair', 'Poor']}
            placeholder="Select condition..."
          />
        </div>
        <div>
          <FieldLabel label="Roof Pitch (Degrees)" />
          <InlineInput
            value={tsf('pitch_degrees')}
            onChange={v => onTsf('pitch_degrees', v)}
            locked={locked}
            placeholder="e.g. 26"
            type="number"
          />
        </div>
        <div>
          <FieldLabel label="Number of Penetrations" />
          <InlineInput
            value={tsf('number_of_penetrations')}
            onChange={v => onTsf('number_of_penetrations', v)}
            locked={locked}
            placeholder="e.g. 4"
            type="number"
          />
        </div>
        <div>
          <FieldLabel label="Number of Storeys" />
          <InlineInput
            value={tsf('number_of_storeys')}
            onChange={v => onTsf('number_of_storeys', v)}
            locked={locked}
            placeholder="e.g. Single Storey"
          />
        </div>
        <div>
          <FieldLabel label="Ridge / Hip Capping and Flashings Condition" />
          <InlineInput
            value={tsf('ridge_hip_condition')}
            onChange={v => onTsf('ridge_hip_condition', v)}
            locked={locked}
            placeholder="e.g. Poor pointing throughout"
          />
        </div>
        <div>
          <FieldLabel label="Gutter and Valley Condition" />
          <InlineInput
            value={tsf('gutter_condition')}
            onChange={v => onTsf('gutter_condition', v)}
            locked={locked}
            placeholder="e.g. Debris blocking valleys and gutters"
          />
        </div>
        <div>
          <FieldLabel label="Gutter Overflows" />
          <InlineInput
            value={tsf('gutter_overflows')}
            onChange={v => onTsf('gutter_overflows', v)}
            locked={locked}
            placeholder="e.g. Yes, at downpipes"
          />
        </div>
        <div>
          <FieldLabel label="Roof Insulation (roof cover only, excludes ceiling insulation)" />
          <MultiSelectDropdown
            value={tsfArray('roof_insulation')}
            onChange={v => onTsfArray('roof_insulation', v)}
            locked={locked}
            options={roofInsulationOptions}
            placeholder="Select insulation type(s)..."
          />
        </div>
      </div>

      {/* — CLAIM DAMAGE FINDINGS — */}
      <SectionHeading label="Claim Damage Findings" />
      <div className="space-y-4">
        <div>
          <FieldLabel label="Specific Cause of Damage" />
          <InlineTextarea
            value={tsf('specific_cause_of_damage')}
            onChange={v => onTsf('specific_cause_of_damage', v)}
            locked={locked}
            placeholder="Describe the specific cause of damage..."
            rows={6}
          />
        </div>
        <div>
          <FieldLabel label="Internal Damage (Claim Related)" />
          <InlineTextarea
            value={tsf('internal_damage')}
            onChange={v => onTsf('internal_damage', v)}
            locked={locked}
            placeholder="Describe internal damage related to the claim..."
            rows={4}
          />
        </div>
        <div>
          <FieldLabel label="Roof Damage (Claim Related)" />
          <InlineTextarea
            value={tsf('roof_damage')}
            onChange={v => onTsf('roof_damage', v)}
            locked={locked}
            placeholder="Describe roof damage related to the claim..."
            rows={4}
          />
        </div>
        <div>
          <FieldLabel label="Roof Maintenance Issues or Roof Cover Defects contributing to claim damage" />
          <InlineTextarea
            value={tsf('damage_caused_by_maintenance')}
            onChange={v => onTsf('damage_caused_by_maintenance', v)}
            locked={locked}
            placeholder="Describe if damage was caused by maintenance issues or defects..."
            rows={3}
          />
        </div>
                <div>
          <FieldLabel label="Non claim related roof comments" />
          <InlineTextarea
            value={tsf('non_claim_maintenance_issues')}
            onChange={v => onTsf('non_claim_maintenance_issues', v)}
            locked={locked}
            placeholder="Describe non-claim related maintenance issues or defects..."
            rows={4}
          />
        </div>
        <div>
          <FieldLabel label="Maintenance or Defects Repairs Required (Insured Responsibility)" />
          <InlineTextarea
            value={tsf('maintenance_repairs_required')}
            onChange={v => onTsf('maintenance_repairs_required', v)}
            locked={locked}
            placeholder="List maintenance or defect repairs required by insured..."
            rows={3}
          />
        </div>
        <div>
          <FieldLabel label="Conditions Preventing Warrantable Repairs" />
          <InlineTextarea
            value={tsf('conditions_preventing_repairs')}
            onChange={v => onTsf('conditions_preventing_repairs', v)}
            locked={locked}
            placeholder="Describe conditions preventing warrantable repairs..."
            rows={2}
          />
        </div>
        <div>
          <FieldLabel label="Prior Repairs to Roof (Claim Related)" />
          <InlineTextarea
            value={tsf('prior_repairs')}
            onChange={v => onTsf('prior_repairs', v)}
            locked={locked}
            placeholder="Describe prior claim-related repairs to the roof..."
            rows={2}
          />
        </div>
      </div>

      {/* — CONCLUSION — */}
      <SectionHeading label="Conclusion" />
      <div>
        <FieldLabel label="Conclusion" />
        <InlineTextarea
          value={tsf('conclusion')}
          onChange={v => onTsf('conclusion', v)}
          locked={locked}
          placeholder="State your professional conclusion regarding the roof and the claim..."
          rows={4}
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
