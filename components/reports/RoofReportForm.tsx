'use client'

import React from 'react'

interface RoofReportFormProps {
  data: Record<string, unknown>
  locked: boolean
  onChange: (field: string, value: unknown) => void
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

export function RoofReportForm({ data, locked, onChange }: RoofReportFormProps) {
  const str = (key: string) => String(data[key] ?? '')
  const tsf = (key: string) => {
    const tsFields = (data.type_specific_fields as Record<string, unknown>) ?? {}
    return String(tsFields[key] ?? '')
  }
  const onTsf = (key: string, value: string) => {
    const tsFields = (data.type_specific_fields as Record<string, unknown>) ?? {}
    onChange('type_specific_fields', { ...tsFields, [key]: value })
  }

  return (
    <div>
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
        <div>
          <FieldLabel label="Roofer's Name & Qualifications" />
          <InlineInput
            value={str('assessor_name')}
            onChange={v => onChange('assessor_name', v)}
            locked={locked}
            placeholder="e.g. Kyle Bindon — Roof plumber, registered builder"
          />
        </div>
        <div>
          <FieldLabel label="Roofer Met With" />
          <InlineInput
            value={str('person_met')}
            onChange={v => onChange('person_met', v)}
            locked={locked}
            placeholder="e.g. Jimmy (tenant)"
          />
        </div>
        <div>
          <FieldLabel label="Time on Site" />
          <InlineInput
            value={tsf('time_on_site')}
            onChange={v => onTsf('time_on_site', v)}
            locked={locked}
            placeholder="e.g. 30 mins"
          />
        </div>
      </div>
      <div className="mt-4">
        <FieldLabel label="Scope of Roof Report" />
        <InlineTextarea
          value={tsf('scope_of_report')}
          onChange={v => onTsf('scope_of_report', v)}
          locked={locked}
          placeholder="Describe the scope and purpose of this roof report..."
          rows={3}
        />
      </div>

      {/* — PROPERTY DETAILS — */}
      <SectionHeading
        label="Property Details"
        subtitle="Pre-filled from AI parse after field app submit"
      />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel label="Property Address" />
          <InlineInput
            value={str('property_address')}
            onChange={v => onChange('property_address', v)}
            locked={locked}
          />
        </div>
        <div>
          <FieldLabel label="Approximate Age" />
          <InlineInput
            value={tsf('approximate_age')}
            onChange={v => onTsf('approximate_age', v)}
            locked={locked}
            placeholder="e.g. 60 years"
          />
        </div>
        <div>
          <FieldLabel label="Property Type" />
          <InlineInput
            value={tsf('property_type')}
            onChange={v => onTsf('property_type', v)}
            locked={locked}
            placeholder="e.g. Residential, freestanding"
          />
        </div>
        <div>
          <FieldLabel label="Property Condition" />
          <InlineInput
            value={tsf('property_condition')}
            onChange={v => onTsf('property_condition', v)}
            locked={locked}
            placeholder="e.g. Fair, Poor, Good"
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
      </div>

      {/* — ROOF DETAILS — */}
      <SectionHeading label="Roof Details" />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel label="Roof Type" />
          <InlineInput
            value={tsf('roof_type')}
            onChange={v => onTsf('roof_type', v)}
            locked={locked}
            placeholder="e.g. Terracotta Tile, Colorbond Metal"
          />
        </div>
        <div>
          <FieldLabel label="General Condition" />
          <InlineInput
            value={tsf('roof_general_condition')}
            onChange={v => onTsf('roof_general_condition', v)}
            locked={locked}
            placeholder="e.g. Poor, Fair, Good"
          />
        </div>
        <div>
          <FieldLabel label="Pitch (Degrees)" />
          <InlineInput
            value={tsf('pitch_degrees')}
            onChange={v => onTsf('pitch_degrees', v)}
            locked={locked}
            placeholder="e.g. 26"
          />
        </div>
        <div>
          <FieldLabel label="Number of Penetrations" />
          <InlineInput
            value={tsf('number_of_penetrations')}
            onChange={v => onTsf('number_of_penetrations', v)}
            locked={locked}
            placeholder="e.g. 4"
          />
        </div>
        <div>
          <FieldLabel label="Ridge / Hip Capping Condition" />
          <InlineInput
            value={tsf('ridge_hip_condition')}
            onChange={v => onTsf('ridge_hip_condition', v)}
            locked={locked}
            placeholder="e.g. Poor pointing throughout"
          />
        </div>
        <div>
          <FieldLabel label="Gutter Condition" />
          <InlineInput
            value={tsf('gutter_condition')}
            onChange={v => onTsf('gutter_condition', v)}
            locked={locked}
            placeholder="e.g. Debris blocking valleys and gutters"
          />
        </div>
      </div>

      {/* — STORM DAMAGE FINDINGS — */}
      <SectionHeading label="Storm Damage Findings" />
      <div className="space-y-4">
        <div>
          <FieldLabel label="Storm Damage Found" />
          <InlineTextarea
            value={tsf('storm_damage_found')}
            onChange={v => onTsf('storm_damage_found', v)}
            locked={locked}
            placeholder="Describe all storm damage observed on the roof..."
            rows={4}
          />
        </div>
        <div>
          <FieldLabel label="Maintenance / Pre-Existing Issues" />
          <InlineTextarea
            value={tsf('maintenance_issues')}
            onChange={v => onTsf('maintenance_issues', v)}
            locked={locked}
            placeholder="Describe maintenance items and pre-existing conditions unrelated to storm..."
            rows={4}
          />
        </div>
        <div>
          <FieldLabel label="Maintenance Repairs Required" />
          <InlineTextarea
            value={str('maintenance_notes')}
            onChange={v => onChange('maintenance_notes', v)}
            locked={locked}
            placeholder="List recommended maintenance repairs..."
            rows={3}
          />
        </div>
        <div>
          <FieldLabel label="Conditions Preventing Warrantable Repairs" />
          <InlineTextarea
            value={tsf('conditions_preventing_repairs')}
            onChange={v => onTsf('conditions_preventing_repairs', v)}
            locked={locked}
            placeholder="e.g. No / Describe any conditions..."
            rows={2}
          />
        </div>
        <div>
          <FieldLabel label="Prior Repairs (Claim Related)" />
          <InlineTextarea
            value={tsf('prior_repairs')}
            onChange={v => onTsf('prior_repairs', v)}
            locked={locked}
            placeholder="e.g. No / Describe any prior claim-related repairs..."
            rows={2}
          />
        </div>
      </div>

      {/* — RECOMMENDATION — */}
      <SectionHeading label="Recommendation" />
      <div>
        <FieldLabel label="Recommendation" />
        <InlineTextarea
          value={tsf('recommendation')}
          onChange={v => onTsf('recommendation', v)}
          locked={locked}
          placeholder="State your professional recommendation regarding the roof and the claim..."
          rows={4}
        />
      </div>

      {/* — ON-SITE SAFETY — */}
      <SectionHeading
        label="On-Site Safety"
        subtitle="From field app roof safety section"
      />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel label="Fall Prevention Control" />
          <InlineInput
            value={tsf('fall_prevention_control')}
            onChange={v => onTsf('fall_prevention_control', v)}
            locked={locked}
            placeholder="e.g. Harness used, ladder secured"
          />
        </div>
        <div>
          <FieldLabel label="Person Present / Lone Worker" />
          <InlineInput
            value={tsf('person_present_lone_worker')}
            onChange={v => onTsf('person_present_lone_worker', v)}
            locked={locked}
            placeholder="e.g. Lone worker — check-in active"
          />
        </div>
        <div>
          <FieldLabel label="Non-Slip Footwear" />
          <InlineInput
            value={tsf('non_slip_footwear')}
            onChange={v => onTsf('non_slip_footwear', v)}
            locked={locked}
            placeholder="e.g. Yes — steel cap boots"
          />
        </div>
        <div>
          <FieldLabel label="Surface Assessed Safe" />
          <InlineInput
            value={tsf('surface_assessed_safe')}
            onChange={v => onTsf('surface_assessed_safe', v)}
            locked={locked}
            placeholder="e.g. Yes / No — reason"
          />
        </div>
      </div>

      {/* — FIELD NOTES — */}
      <SectionHeading label="Field Notes (Internal)" />
      <div>
        <FieldLabel label="Raw Report Dump" />
        <InlineTextarea
          value={str('raw_report_dump')}
          onChange={v => onChange('raw_report_dump', v)}
          locked={locked}
          placeholder="Raw dictation or field notes (internal only, not included in PDF)..."
          rows={4}
        />
      </div>
    </div>
  )
}
