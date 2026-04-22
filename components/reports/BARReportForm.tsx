'use client'

import React, { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { ReportPhotos } from './ReportPhotos'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface BARReportFormProps {
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

export function BARReportForm({ data, locked, onChange, tenantId, reportId, jobId }: BARReportFormProps) {
  const [generating, setGenerating] = useState(false)
  const str = (key: string) => String(data[key] ?? '')

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
          reportType: 'BAR',
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
          <FieldLabel label="Assessor Name" />
          <InlineInput
            value={str('assessor_name')}
            onChange={v => onChange('assessor_name', v)}
            locked={locked}
            placeholder="e.g. Kyle Bindon"
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
            placeholder="Full property address"
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
        <div>
          <FieldLabel label="Loss Type" />
          <InlineInput
            value={str('loss_type')}
            onChange={v => onChange('loss_type', v)}
            locked={locked}
            placeholder="e.g. Storm, Water, Fire"
          />
        </div>
      </div>

      {/* — INCIDENT — */}
      <SectionHeading label="Incident" />
      <div className="space-y-4">
        <div>
          <FieldLabel label="Incident / Client Discussion" />
          <InlineTextarea
            value={str('incident_description')}
            onChange={v => onChange('incident_description', v)}
            locked={locked}
            placeholder="Describe what the insured reported regarding the incident..."
            rows={4}
          />
        </div>
        <div>
          <FieldLabel label="Cause of Damage" />
          <InlineTextarea
            value={str('cause_of_damage')}
            onChange={v => onChange('cause_of_damage', v)}
            locked={locked}
            placeholder="State the identified cause of damage..."
            rows={3}
          />
        </div>
        <div>
          <FieldLabel label="How Damage Occurred" />
          <InlineTextarea
            value={str('how_damage_occurred')}
            onChange={v => onChange('how_damage_occurred', v)}
            locked={locked}
            placeholder="Describe the mechanism of damage in detail..."
            rows={4}
          />
        </div>
      </div>

      {/* — DAMAGE FINDINGS — */}
      <SectionHeading label="Damage Findings" />
      <div className="space-y-4">
        <div>
          <FieldLabel label="Resulting Damage" />
          <InlineTextarea
            value={str('resulting_damage')}
            onChange={v => onChange('resulting_damage', v)}
            locked={locked}
            placeholder="List all damage observed during inspection..."
            rows={5}
          />
        </div>
        <div>
          <FieldLabel label="Pre-Existing Conditions" />
          <InlineTextarea
            value={str('pre_existing_conditions')}
            onChange={v => onChange('pre_existing_conditions', v)}
            locked={locked}
            placeholder="Note any pre-existing damage or conditions unrelated to the claim..."
            rows={3}
          />
        </div>
        <div>
          <FieldLabel label="Maintenance" />
          <InlineTextarea
            value={str('maintenance_notes')}
            onChange={v => onChange('maintenance_notes', v)}
            locked={locked}
            placeholder="Note any maintenance items observed..."
            rows={3}
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
          placeholder="State your professional opinion and conclusions regarding the claim..."
          rows={5}
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
