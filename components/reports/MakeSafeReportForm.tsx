'use client'

import React from 'react'

interface MakeSafeReportFormProps {
  data: Record<string, unknown>
  locked: boolean
  onChange: (field: string, value: unknown) => void
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

function RadioGroup({
  label,
  value,
  onChange,
  locked,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  locked: boolean
  options: string[]
}) {
  return (
    <div>
      <FieldLabel label={label} />
      <div className="flex gap-4 mt-1">
        {options.map(opt => (
          <label
            key={opt}
            className={`flex items-center gap-2 text-[13px] text-[#3a3530] ${locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
            style={{ fontFamily: 'DM Sans, sans-serif' }}
          >
            <input
              type="radio"
              value={opt}
              checked={value === opt}
              onChange={() => !locked && onChange(opt)}
              disabled={locked}
              className="accent-[#c8b89a]"
            />
            {opt}
          </label>
        ))}
      </div>
    </div>
  )
}

export function MakeSafeReportForm({ data, locked, onChange }: MakeSafeReportFormProps) {
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
          <FieldLabel label="Assessor Name" />
          <InlineInput
            value={str('assessor_name')}
            onChange={v => onChange('assessor_name', v)}
            locked={locked}
            placeholder="e.g. Kyle Bindon"
          />
        </div>
        <div>
          <FieldLabel label="Person Met" />
          <InlineInput
            value={str('person_met')}
            onChange={v => onChange('person_met', v)}
            locked={locked}
            placeholder="e.g. Karen Nowell (Owner)"
          />
        </div>
      </div>

      {/* — PROPERTY — */}
      <SectionHeading label="Property" />
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <FieldLabel label="Property Address" />
          <InlineInput
            value={str('property_address')}
            onChange={v => onChange('property_address', v)}
            locked={locked}
          />
        </div>
        <div>
          <FieldLabel label="Insured Name" />
          <InlineInput
            value={str('insured_name')}
            onChange={v => onChange('insured_name', v)}
            locked={locked}
          />
        </div>
        <div>
          <FieldLabel label="Claim Number" />
          <InlineInput
            value={str('claim_number')}
            onChange={v => onChange('claim_number', v)}
            locked={locked}
          />
        </div>
      </div>

      {/* — IMMEDIATE HAZARDS — */}
      <SectionHeading label="Immediate Hazards" />
      <div>
        <FieldLabel label="Hazards Identified" />
        <InlineTextarea
          value={tsf('immediate_hazards')}
          onChange={v => onTsf('immediate_hazards', v)}
          locked={locked}
          placeholder="Describe all immediate safety hazards identified at the property..."
          rows={4}
        />
      </div>

      {/* — WORKS CARRIED OUT — */}
      <SectionHeading label="Works Carried Out" />
      <div className="space-y-4">
        <div>
          <FieldLabel label="Make Safe Works Carried Out" />
          <InlineTextarea
            value={tsf('works_carried_out')}
            onChange={v => onTsf('works_carried_out', v)}
            locked={locked}
            placeholder="Describe all make safe works performed during attendance..."
            rows={5}
          />
        </div>
        <div>
          <FieldLabel label="Further Works Required" />
          <InlineTextarea
            value={tsf('further_works_required')}
            onChange={v => onTsf('further_works_required', v)}
            locked={locked}
            placeholder="Describe any additional works required beyond this make safe..."
            rows={4}
          />
        </div>
      </div>

      {/* — PROPERTY STATUS — */}
      <SectionHeading label="Property Status" />
      <div className="grid grid-cols-2 gap-4">
        <RadioGroup
          label="Safe to Occupy"
          value={tsf('safe_to_occupy')}
          onChange={v => onTsf('safe_to_occupy', v)}
          locked={locked}
          options={['Yes', 'No', 'Conditional']}
        />
        <div>
          <FieldLabel label="Occupancy Conditions (if conditional)" />
          <InlineInput
            value={tsf('occupancy_conditions')}
            onChange={v => onTsf('occupancy_conditions', v)}
            locked={locked}
            placeholder="e.g. Avoid affected rooms until repairs complete"
          />
        </div>
      </div>

      {/* — FEE SCHEDULE — */}
      <SectionHeading label="Fee Schedule" />
      <div>
        <FieldLabel label="Fee Schedule / Materials Used" />
        <InlineTextarea
          value={tsf('fee_schedule')}
          onChange={v => onTsf('fee_schedule', v)}
          locked={locked}
          placeholder="List materials and labour charges for make safe works..."
          rows={4}
        />
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
