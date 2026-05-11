'use client'

import React, { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { ReportPhotos } from './ReportPhotos'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface MakeSafeReportFormProps {
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

export function MakeSafeReportForm({ data, locked, onChange, tenantId, reportId, jobId }: MakeSafeReportFormProps) {
  const [generating, setGenerating] = useState(false)
  const str = (key: string) => String(data[key] ?? '')
  const tsf = (key: string) => {
    const tsFields = (data.type_specific_fields as Record<string, unknown>) ?? {}
    return String(tsFields[key] ?? '')
  }
  const onTsf = (key: string, value: string) => {
    const tsFields = (data.type_specific_fields as Record<string, unknown>) ?? {}
    onChange('type_specific_fields', { ...tsFields, [key]: value })
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
          reportType: 'make_safe',
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
          // For make_safe reports, some fields are in type_specific_fields
          if (['immediate_hazards', 'works_carried_out', 'further_works_required', 'safe_to_occupy', 'occupancy_conditions', 'fee_schedule'].includes(key)) {
            onTsf(key, value)
          } else {
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

      {/* — FIELD NOTES — */}
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
          placeholder="Raw dictation or field notes (internal only, not included in PDF)..."
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
