'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Smartphone, FileText, DollarSign, Plus, ChevronDown, ChevronRight, CheckCircle2, Clock, AlertCircle } from 'lucide-react'
import { AccordionList } from './shared/AccordionList'
import { AccordionRow } from './shared/AccordionRow'
import { CreateModal } from './shared/CreateModal'
import { useInspectionAutosave } from '../hooks/useInspectionAutosave'

// — Types ——————————————————————————————————————————————————————————
interface Inspection {
  id: string
  tenant_id: string
  job_id: string
  inspection_ref: string | null
  scheduled_date: string | null
  start_time: string | null
  finish_time: string | null
  duration_minutes: number | null
  status: string
  person_met: string | null
  access_notes: string | null  // repurposed for assessor name
  notes: string | null
  field_draft: Record<string, unknown> | null
  quote_id: string | null
  report_id: string | null
  created_at: string
}

interface Report {
  id: string
  report_ref: string | null
  report_type: 'BAR' | 'make_safe' | 'roof' | 'specialist' | 'LDR'
  status: string
  is_locked: boolean
  attendance_date: string | null
  assessor_name: string | null
  pdf_storage_path: string | null
  created_at: string
}

interface Quote {
  id: string
  quote_ref: string | null
  quote_type: 'inspection' | 'variation' | 'additional_works'
  status: string
  is_locked: boolean
  total_amount: number | null
  pdf_storage_path: string | null
  created_at: string
}

interface Invoice {
  id: string
  invoice_ref: string | null
  invoice_type: string
  direction: 'inbound' | 'outbound'
  amount_ex_gst: number | null
  status: string
  report_id: string | null
  created_at: string
}

interface InspectionWithRelations {
  inspection: Inspection
  coreReport: Report | null
  coreQuote: Quote | null
  coreInvoice: Invoice | null
  additionalReports: Report[]
  additionalInvoices: Invoice[]
  tradeQuotes: Quote[]
}

interface InspectionsTabProps {
  jobId: string
  tenantId: string
  jobNumber: string
}

// — Status pill ————————————————————————————————————————————————————
const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  complete:  { bg: '#e8f5e9', text: '#2e7d32' },
  pending:   { bg: '#fff8e1', text: '#b45309' },
  draft:     { bg: '#f5f2ee', text: '#9e998f' },
}

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLES[status.toLowerCase()] ?? STATUS_STYLES.draft
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize"
      style={{ background: s.bg, color: s.text }}
    >
      {status}
    </span>
  )
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatTime(t: string | null) {
  if (!t) return ''
  const [hours, minutes] = t.split(':')
  const hour = parseInt(hours)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 || 12
  return `${hour12}:${minutes} ${ampm}`
}

// Helper functions for time calculations
function calculateFinishTime(start: string, dur: string) {
  if (!start || !dur) return ''
  const [hours, minutes] = start.split(':').map(Number)
  const duration = parseInt(dur) || 60
  const totalMinutes = hours * 60 + minutes + duration
  const endHours = Math.floor(totalMinutes / 60) % 24
  const endMinutes = totalMinutes % 60
  return `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`
}

const INSPECTION_TYPES = [
  'Building Assessment',
  'Make Safe',
  'Roof Inspection',
  'Leak Detection',
]

const inputStyle: React.CSSProperties = {
  fontFamily: 'DM Sans, sans-serif',
  fontSize: 13,
  background: '#fff',
  border: '1px solid #e0dbd4',
  borderRadius: 6,
  padding: '7px 10px',
  width: '100%',
  outline: 'none',
  color: '#3a3530',
}

const labelStyle: React.CSSProperties = {
  fontFamily: 'DM Sans, sans-serif',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  color: '#9e998f',
  display: 'block',
  marginBottom: 5,
}

// — Inspection row form —————————————————————————————————————————
function InspectionForm({
  inspection,
  tenantId,
  onDelete,
}: {
  inspection: Inspection
  tenantId: string
  onDelete: (id: string) => void
}) {
  const [date, setDate] = useState(inspection.scheduled_date ?? '')
  const [startTime, setStartTime] = useState(inspection.start_time ?? '')
  const [finishTime, setFinishTime] = useState(inspection.finish_time ?? '')
  // Only use default for new inspections (duration_minutes is null)
  const [duration, setDuration] = useState(
    inspection.duration_minutes !== null 
      ? inspection.duration_minutes.toString() 
      : '120'
  )
  const [status, setStatus] = useState(inspection.status)
  const [personMet, setPersonMet] = useState(inspection.person_met ?? '')
  const [assessor, setAssessor] = useState(inspection.access_notes ?? '')
  const [notes, setNotes] = useState(inspection.notes ?? '')
  const [deleting, setDeleting] = useState(false)

  const { scheduleFieldSave, flushSave, saveState } = useInspectionAutosave({
    inspectionId: inspection.id,
    tenantId,
  })

  // Save on unmount to prevent data loss
  useEffect(() => {
    return () => {
      flushSave()
    }
  }, [flushSave])

  // Calculate finish time from start time and duration
  const calculateFinishTime = (start: string, dur: string) => {
    if (!start || !dur) return ''
    const [hours, minutes] = start.split(':').map(Number)
    const duration = parseInt(dur) || 120
    const totalMinutes = hours * 60 + minutes + duration
    const endHours = Math.floor(totalMinutes / 60) % 24
    const endMinutes = totalMinutes % 60
    return `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`
  }

  // Calculate duration from start and finish time
  const calculateDuration = (start: string, finish: string) => {
    if (!start || !finish) return '120'
    const [startHours, startMinutes] = start.split(':').map(Number)
    const [finishHours, finishMinutes] = finish.split(':').map(Number)
    const startTotal = startHours * 60 + startMinutes
    const finishTotal = finishHours * 60 + finishMinutes
    const diff = finishTotal - startTotal
    return diff > 0 ? diff.toString() : '120'
  }

  // Handle start time change - auto-calculate finish time
  const handleStartTimeChange = (value: string) => {
    setStartTime(value)
    scheduleFieldSave('start_time', value || null)
    const newFinishTime = calculateFinishTime(value, duration)
    setFinishTime(newFinishTime)
    scheduleFieldSave('finish_time', newFinishTime || null)
  }

  // Handle finish time change - auto-calculate duration
  const handleFinishTimeChange = (value: string) => {
    setFinishTime(value)
    const newDuration = calculateDuration(startTime, value)
    setDuration(newDuration)
    scheduleFieldSave('finish_time', value || null)
    scheduleFieldSave('duration_minutes', parseInt(newDuration) || null)
  }

  // Handle duration change - auto-calculate finish time
  const handleDurationChange = (value: string) => {
    setDuration(value)
    const newFinishTime = calculateFinishTime(startTime, value)
    setFinishTime(newFinishTime)
    // Save immediately to prevent loss on unmount
    scheduleFieldSave('duration_minutes', parseInt(value) || null)
    scheduleFieldSave('finish_time', newFinishTime || null)
    flushSave() // Force immediate save
  }

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  function handleChange(field: string, value: string, setter: (v: string) => void) {
    setter(value)
    scheduleFieldSave(field, value || null)
  }

  async function handleDelete() {
    if (!confirm('Delete this inspection?')) return
    setDeleting(true)
    await supabase
      .from('inspections')
      .delete()
      .eq('id', inspection.id)
      .eq('tenant_id', tenantId)
    onDelete(inspection.id)
  }

  const saveLabel =
    saveState.status === 'saving' ? 'Saving…'
    : saveState.status === 'saved' ? 'Saved'
    : saveState.status === 'error' ? 'Error'
    : ''

  return (
    <div style={{ fontFamily: 'DM Sans, sans-serif' }}>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label style={labelStyle}>Date</label>
          <input
            type="date"
            value={date}
            style={inputStyle}
            onChange={e => handleChange('scheduled_date', e.target.value, setDate)}
            onBlur={flushSave}
            onFocus={e => (e.currentTarget.style.borderColor = '#c8b89a')}
          />
        </div>
        <div>
          <label style={labelStyle}>Start Time</label>
          <input
            type="time"
            value={startTime}
            style={inputStyle}
            onChange={e => handleStartTimeChange(e.target.value)}
            onBlur={flushSave}
            onFocus={e => (e.currentTarget.style.borderColor = '#c8b89a')}
          />
        </div>
        <div>
          <label style={labelStyle}>Finish Time</label>
          <input
            type="time"
            value={finishTime}
            style={inputStyle}
            onChange={e => handleFinishTimeChange(e.target.value)}
            onBlur={flushSave}
            onFocus={e => (e.currentTarget.style.borderColor = '#c8b89a')}
          />
        </div>
        <div>
          <label style={labelStyle}>Duration (min)</label>
          <input
            type="number"
            value={duration}
            min="15"
            step="15"
            style={inputStyle}
            onChange={e => handleDurationChange(e.target.value)}
            onBlur={flushSave}
            onFocus={e => (e.currentTarget.style.borderColor = '#c8b89a')}
          />
        </div>
        <div>
          <label style={labelStyle}>Status</label>
          <select
            value={status}
            style={inputStyle}
            onChange={e => handleChange('status', e.target.value, setStatus)}
            onFocus={e => (e.currentTarget.style.borderColor = '#c8b89a')}
            onBlur={e => {
              e.currentTarget.style.borderColor = '#e0dbd4'
              flushSave()
            }}
          >
            <option value="draft">Draft</option>
            <option value="pending">Pending</option>
            <option value="complete">Complete</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Person Met</label>
          <input
            type="text"
            value={personMet}
            style={inputStyle}
            onChange={e => handleChange('person_met', e.target.value, setPersonMet)}
            onBlur={flushSave}
            onFocus={e => (e.currentTarget.style.borderColor = '#c8b89a')}
          />
        </div>
        <div>
          <label style={labelStyle}>Assessor</label>
          <input
            type="text"
            value={assessor}
            style={inputStyle}
            onChange={e => handleChange('access_notes', e.target.value, setAssessor)}
            onBlur={flushSave}
            onFocus={e => (e.currentTarget.style.borderColor = '#c8b89a')}
          />
        </div>
      </div>
      <div className="mb-4">
        <label style={labelStyle}>Inspection Notes</label>
        <textarea
          value={notes}
          rows={4}
          style={{ ...inputStyle, resize: 'vertical' }}
          onChange={e => handleChange('notes', e.target.value, setNotes)}
          onBlur={flushSave}
          onFocus={e => (e.currentTarget.style.borderColor = '#c8b89a')}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[#9e998f]">{saveLabel}</span>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-[12px] text-red-500 hover:text-red-700 transition-colors"
        >
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </div>
  )
}

// — InspectionsTab ——————————————————————————————————————————————
export function InspectionsTab({ jobId, tenantId, jobNumber }: InspectionsTabProps) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [inspectionsWithRelations, setInspectionsWithRelations] = useState<InspectionWithRelations[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Record<string, Set<string>>>({})
  const [submittingInspectionId, setSubmittingInspectionId] = useState<string | null>(null)

  const fetchInspectionsWithRelations = useCallback(async () => {
    setLoading(true)
    
    // Fetch all inspections for this job
    const { data: inspections, error: inspError } = await supabase
      .from('inspections')
      .select('id,tenant_id,job_id,inspection_ref,scheduled_date,start_time,finish_time,duration_minutes,status,person_met,access_notes,notes,field_draft,quote_id,report_id,created_at')
      .eq('job_id', jobId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })

    if (inspError || !inspections) {
      setLoading(false)
      return
    }

    // Fetch all related data for each inspection
    const inspectionsData: InspectionWithRelations[] = await Promise.all(
      inspections.map(async (inspection: Inspection) => {
        // Fetch core report (BAR)
        const { data: coreReport } = inspection.report_id
          ? await supabase.from('reports').select('*').eq('id', inspection.report_id).single()
          : { data: null }

        // Fetch core quote
        const { data: coreQuote } = inspection.quote_id
          ? await supabase.from('quotes').select('*').eq('id', inspection.quote_id).single()
          : { data: null }

        // Fetch core invoice (invoice linked to core report)
        const { data: coreInvoice } = coreReport
          ? await supabase.from('invoices').select('*').eq('report_id', coreReport.id).eq('direction', 'outbound').maybeSingle()
          : { data: null }

        // Fetch additional reports linked to this inspection (not the core BAR)
        const { data: additionalReports } = await supabase
          .from('reports')
          .select('*')
          .eq('inspection_id', inspection.id)
          .neq('id', inspection.report_id || '')
          .order('created_at', { ascending: true })

        // Fetch invoices for additional reports
        const additionalReportIds = (additionalReports || []).map((r: Report) => r.id)
        const { data: additionalInvoices } = additionalReportIds.length > 0
          ? await supabase.from('invoices').select('*').in('report_id', additionalReportIds).eq('direction', 'outbound')
          : { data: [] }

        // Fetch trade quote requests (quotes with quote_type = 'trade_request' or similar - need to identify these)
        // For now, we'll fetch all quotes linked to this inspection that aren't the core quote
        const { data: tradeQuotes } = await supabase
          .from('quotes')
          .select('*')
          .eq('inspection_id', inspection.id)
          .neq('id', inspection.quote_id || '')
          .order('created_at', { ascending: true })

        return {
          inspection,
          coreReport: coreReport as Report | null,
          coreQuote: coreQuote as Quote | null,
          coreInvoice: coreInvoice as Invoice | null,
          additionalReports: (additionalReports || []) as Report[],
          additionalInvoices: (additionalInvoices || []) as Invoice[],
          tradeQuotes: (tradeQuotes || []) as Quote[],
        }
      })
    )

    setInspectionsWithRelations(inspectionsData)
    setLoading(false)
  }, [jobId, tenantId, supabase])

  useEffect(() => {
    fetchInspectionsWithRelations()
  }, [fetchInspectionsWithRelations])

  async function handleCreate(data: Record<string, string>) {
    const fieldDraft = { type: data['Type'] ?? '' }
    const startTime = data['Start Time'] || null
    const duration = parseInt(data['Duration'] || '60') || 60
    const finishTime = startTime ? calculateFinishTime(startTime, duration.toString()) : null
    
    // Create inspection
    const { data: inserted, error: inspError } = await supabase
      .from('inspections')
      .insert({
        tenant_id: tenantId,
        job_id: jobId,
        status: 'draft',
        scheduled_date: data['Date'] || null,
        start_time: startTime,
        finish_time: finishTime,
        duration_minutes: duration,
        access_notes: data['Assessor'] || null,
        person_met: data['Person Met'] || null,
        field_draft: fieldDraft,
      })
      .select('id,tenant_id,job_id,inspection_ref,scheduled_date,start_time,finish_time,duration_minutes,status,person_met,access_notes,notes,field_draft,quote_id,report_id,created_at')
      .single()
    
    if (inspError) throw inspError

    // Create core BAR report for this inspection
    const inspectionId = inserted.id
    const existingCount = inspectionsWithRelations.length
    const newIndex = String(existingCount + 1).padStart(3, '0')
    const reportRef = `RPT-${jobNumber}-${newIndex}`
    const quoteRef = `Q-${jobNumber}-${newIndex}`

    const { data: newReport, error: reportError } = await supabase
      .from('reports')
      .insert({
        tenant_id: tenantId,
        job_id: jobId,
        inspection_id: inspectionId,
        report_ref: reportRef,
        report_type: 'BAR',
        status: 'draft',
        is_locked: false,
        version: 1,
        type_specific_fields: {},
      })
      .select()
      .single()

    if (reportError) throw reportError

    // Create core quote for this inspection
    const { data: newQuote, error: quoteError } = await supabase
      .from('quotes')
      .insert({
        tenant_id: tenantId,
        job_id: jobId,
        inspection_id: inspectionId,
        report_id: newReport.id,
        quote_ref: quoteRef,
        quote_type: 'inspection',
        version: 1,
        is_active_version: true,
        is_locked: false,
        status: 'draft',
      })
      .select()
      .single()

    if (quoteError) throw quoteError

    // Link report and quote to inspection
    const { error: updateError } = await supabase
      .from('inspections')
      .update({ report_id: newReport.id, quote_id: newQuote.id })
      .eq('id', inspectionId)

    if (updateError) throw updateError

    // Refresh data
    await fetchInspectionsWithRelations()
  }

  function handleDelete(id: string) {
    setInspectionsWithRelations(prev => prev.filter(i => i.inspection.id !== id))
  }

  function toggleSection(inspectionId: string, sectionKey: string) {
    setExpandedSections(prev => {
      const current = prev[inspectionId] || new Set()
      const newSet = new Set(current)
      if (newSet.has(sectionKey)) {
        newSet.delete(sectionKey)
      } else {
        newSet.add(sectionKey)
      }
      return { ...prev, [inspectionId]: newSet }
    })
  }

  function isSectionExpanded(inspectionId: string, sectionKey: string): boolean {
    return (expandedSections[inspectionId] || new Set()).has(sectionKey)
  }

  const typeLabel = (insp: Inspection) => {
    const draft = insp.field_draft as Record<string, unknown> | null
    return (draft?.type as string | undefined) || 'Building Assessment'
  }

  const getStatusIcon = (status: string) => {
    const s = status.toLowerCase()
    if (s === 'complete' || s === 'submitted') return <CheckCircle2 size={14} className="text-green-600" />
    if (s === 'in_progress') return <Clock size={14} className="text-blue-600" />
    return <AlertCircle size={14} className="text-amber-600" />
  }

  const getReportTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'BAR': 'BAR',
      'make_safe': 'Make Safe',
      'roof': 'Roof Report',
      'specialist': 'Specialist Report',
      'LDR': 'Leak Detection',
    }
    return labels[type] || type
  }

  const getQuoteTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'inspection': 'Inspection Quote',
      'variation': 'Variation',
      'additional_works': 'Additional Works',
    }
    return labels[type] || type
  }

  const handleCompileAndSubmit = async (inspectionId: string) => {
    setSubmittingInspectionId(inspectionId)
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      const json = await res.json()
      if (!res.ok) {
        alert(json.error || 'Failed to submit inspection package')
        return
      }
      // Refresh data to show updated statuses
      await fetchInspectionsWithRelations()
      alert('Inspection package submitted successfully')
    } catch (error) {
      console.error('Error submitting inspection:', error)
      alert('Failed to submit inspection package')
    } finally {
      setSubmittingInspectionId(null)
    }
  }

  return (
    <>
      {loading ? (
        <div className="py-12 text-center text-[13px] text-[#9e998f]">Loading…</div>
      ) : (
        <AccordionList
          title="Inspections"
          action={{ label: '+ New inspection', onClick: () => setShowCreate(true) }}
        >
          {inspectionsWithRelations.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-[#9e998f]">
              No inspections yet
            </div>
          ) : (
            inspectionsWithRelations.map(({ inspection, coreReport, coreQuote, coreInvoice, additionalReports, additionalInvoices, tradeQuotes }) => (
              <AccordionRow
                key={inspection.id}
                summary={
                  <div className="flex items-center gap-3 flex-wrap">
                    <span
                      className="text-[13px] font-medium"
                      style={{ fontFamily: 'DM Mono, monospace', color: '#c8b89a' }}
                    >
                      {inspection.inspection_ref ?? '—'}
                    </span>
                    <span className="text-[13px] text-[#3a3530]">{typeLabel(inspection)}</span>
                    <span className="text-[12px] text-[#9e998f]">{formatDate(inspection.scheduled_date)}</span>
                    {inspection.start_time && (
                      <span className="text-[12px] text-[#9e998f]">{formatTime(inspection.start_time)}</span>
                    )}
                    {inspection.access_notes && (
                      <span className="text-[12px] text-[#9e998f]">{inspection.access_notes}</span>
                    )}
                    {inspection.person_met && (
                      <span className="text-[12px] text-[#9e998f]">{inspection.person_met}</span>
                    )}
                    <div className="flex items-center gap-1">
                      {getStatusIcon(inspection.status)}
                      <StatusPill status={inspection.status} />
                    </div>
                    <a
                      href={`/field/${inspection.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#1a1a1a] text-[#c8b89a] text-[12px] font-medium rounded-md hover:bg-[#252520] transition-colors"
                    >
                      <Smartphone className="h-3.5 w-3.5" />
                      Field App
                    </a>
                  </div>
                }
              >
                <div className="space-y-4">
                  {/* Inspection Details */}
                  <InspectionForm
                    inspection={inspection}
                    tenantId={tenantId}
                    onDelete={handleDelete}
                  />

                  {/* Core Package Section */}
                  <div className="border border-[#e4dfd8] rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleSection(inspection.id, 'core')}
                      className="w-full px-4 py-3 flex items-center justify-between bg-[#faf9f7] hover:bg-[#f5f2ee] transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <FileText size={16} className="text-[#c8b89a]" />
                        <span className="text-[13px] font-medium text-[#3a3530]">Core Package (BAR + Quote + Invoice)</span>
                      </div>
                      {isSectionExpanded(inspection.id, 'core') ? (
                        <ChevronDown size={16} className="text-[#9e998f]" />
                      ) : (
                        <ChevronRight size={16} className="text-[#9e998f]" />
                      )}
                    </button>
                    {isSectionExpanded(inspection.id, 'core') && (
                      <div className="p-4 space-y-3">
                        {/* Core BAR Report */}
                        {coreReport ? (
                          <div className="flex items-center justify-between p-3 bg-white border border-[#e4dfd8] rounded-md">
                            <div className="flex items-center gap-3">
                              <FileText size={14} className="text-blue-600" />
                              <div>
                                <div className="text-[13px] font-medium text-[#3a3530]">{coreReport.report_ref}</div>
                                <div className="text-[11px] text-[#9e998f]">{getReportTypeLabel(coreReport.report_type)}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <StatusPill status={coreReport.status} />
                              {coreReport.pdf_storage_path && (
                                <button className="text-[11px] text-[#1a73e8] hover:underline">View PDF</button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="text-[12px] text-[#9e998f] italic">No BAR report created</div>
                        )}

                        {/* Core Quote */}
                        {coreQuote ? (
                          <div className="flex items-center justify-between p-3 bg-white border border-[#e4dfd8] rounded-md">
                            <div className="flex items-center gap-3">
                              <DollarSign size={14} className="text-green-600" />
                              <div>
                                <div className="text-[13px] font-medium text-[#3a3530]">{coreQuote.quote_ref}</div>
                                <div className="text-[11px] text-[#9e998f]">{getQuoteTypeLabel(coreQuote.quote_type)}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <StatusPill status={coreQuote.status} />
                              {coreQuote.total_amount && (
                                <div className="text-[12px] font-medium text-[#3a3530]">
                                  ${coreQuote.total_amount.toLocaleString()}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="text-[12px] text-[#9e998f] italic">No quote created</div>
                        )}

                        {/* Core Invoice */}
                        {coreInvoice ? (
                          <div className="flex items-center justify-between p-3 bg-white border border-[#e4dfd8] rounded-md">
                            <div className="flex items-center gap-3">
                              <DollarSign size={14} className="text-purple-600" />
                              <div>
                                <div className="text-[13px] font-medium text-[#3a3530]">{coreInvoice.invoice_ref}</div>
                                <div className="text-[11px] text-[#9e998f]">{coreInvoice.invoice_type}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <StatusPill status={coreInvoice.status} />
                              {coreInvoice.amount_ex_gst && (
                                <div className="text-[12px] font-medium text-[#3a3530]">
                                  ${coreInvoice.amount_ex_gst.toLocaleString()}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="text-[12px] text-[#9e998f] italic">No invoice created</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Additional Reports Section */}
                  {additionalReports.length > 0 && (
                    <div className="border border-[#e4dfd8] rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleSection(inspection.id, 'additional')}
                        className="w-full px-4 py-3 flex items-center justify-between bg-[#faf9f7] hover:bg-[#f5f2ee] transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <FileText size={16} className="text-[#c8b89a]" />
                          <span className="text-[13px] font-medium text-[#3a3530]">
                            Additional Reports ({additionalReports.length})
                          </span>
                        </div>
                        {isSectionExpanded(inspection.id, 'additional') ? (
                          <ChevronDown size={16} className="text-[#9e998f]" />
                        ) : (
                          <ChevronRight size={16} className="text-[#9e998f]" />
                        )}
                      </button>
                      {isSectionExpanded(inspection.id, 'additional') && (
                        <div className="p-4 space-y-2">
                          {additionalReports.map(report => (
                            <div key={report.id} className="flex items-center justify-between p-3 bg-white border border-[#e4dfd8] rounded-md">
                              <div className="flex items-center gap-3">
                                <FileText size={14} className="text-blue-600" />
                                <div>
                                  <div className="text-[13px] font-medium text-[#3a3530]">{report.report_ref}</div>
                                  <div className="text-[11px] text-[#9e998f]">{getReportTypeLabel(report.report_type)}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <StatusPill status={report.status} />
                                {report.pdf_storage_path && (
                                  <button className="text-[11px] text-[#1a73e8] hover:underline">View PDF</button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Linked Invoices Section */}
                  {(additionalInvoices.length > 0 || coreInvoice) && (
                    <div className="border border-[#e4dfd8] rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleSection(inspection.id, 'invoices')}
                        className="w-full px-4 py-3 flex items-center justify-between bg-[#faf9f7] hover:bg-[#f5f2ee] transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <DollarSign size={16} className="text-[#c8b89a]" />
                          <span className="text-[13px] font-medium text-[#3a3530]">
                            Linked Invoices ({(coreInvoice ? 1 : 0) + additionalInvoices.length})
                          </span>
                        </div>
                        {isSectionExpanded(inspection.id, 'invoices') ? (
                          <ChevronDown size={16} className="text-[#9e998f]" />
                        ) : (
                          <ChevronRight size={16} className="text-[#9e998f]" />
                        )}
                      </button>
                      {isSectionExpanded(inspection.id, 'invoices') && (
                        <div className="p-4 space-y-2">
                          {coreInvoice && (
                            <div className="flex items-center justify-between p-3 bg-white border border-[#e4dfd8] rounded-md">
                              <div className="flex items-center gap-3">
                                <DollarSign size={14} className="text-purple-600" />
                                <div>
                                  <div className="text-[13px] font-medium text-[#3a3530]">{coreInvoice.invoice_ref}</div>
                                  <div className="text-[11px] text-[#9e998f]">BAR Fee</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <StatusPill status={coreInvoice.status} />
                                {coreInvoice.amount_ex_gst && (
                                  <div className="text-[12px] font-medium text-[#3a3530]">
                                    ${coreInvoice.amount_ex_gst.toLocaleString()}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                          {additionalInvoices.map(invoice => (
                            <div key={invoice.id} className="flex items-center justify-between p-3 bg-white border border-[#e4dfd8] rounded-md">
                              <div className="flex items-center gap-3">
                                <DollarSign size={14} className="text-purple-600" />
                                <div>
                                  <div className="text-[13px] font-medium text-[#3a3530]">{invoice.invoice_ref}</div>
                                  <div className="text-[11px] text-[#9e998f]">{invoice.invoice_type}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <StatusPill status={invoice.status} />
                                {invoice.amount_ex_gst && (
                                  <div className="text-[12px] font-medium text-[#3a3530]">
                                    ${invoice.amount_ex_gst.toLocaleString()}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Trade Quote Requests Section */}
                  {tradeQuotes.length > 0 && (
                    <div className="border border-[#e4dfd8] rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleSection(inspection.id, 'trade')}
                        className="w-full px-4 py-3 flex items-center justify-between bg-[#faf9f7] hover:bg-[#f5f2ee] transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <DollarSign size={16} className="text-[#c8b89a]" />
                          <span className="text-[13px] font-medium text-[#3a3530]">
                            Trade Quote Requests ({tradeQuotes.length})
                          </span>
                        </div>
                        {isSectionExpanded(inspection.id, 'trade') ? (
                          <ChevronDown size={16} className="text-[#9e998f]" />
                        ) : (
                          <ChevronRight size={16} className="text-[#9e998f]" />
                        )}
                      </button>
                      {isSectionExpanded(inspection.id, 'trade') && (
                        <div className="p-4 space-y-2">
                          {tradeQuotes.map(quote => (
                            <div key={quote.id} className="flex items-center justify-between p-3 bg-white border border-[#e4dfd8] rounded-md">
                              <div className="flex items-center gap-3">
                                <DollarSign size={14} className="text-orange-600" />
                                <div>
                                  <div className="text-[13px] font-medium text-[#3a3530]">{quote.quote_ref}</div>
                                  <div className="text-[11px] text-[#9e998f]">{getQuoteTypeLabel(quote.quote_type)}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <StatusPill status={quote.status} />
                                {quote.total_amount && (
                                  <div className="text-[12px] font-medium text-[#3a3530]">
                                    ${quote.total_amount.toLocaleString()}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Compile & Submit Button */}
                  <div className="flex justify-end pt-2">
                    <button
                      className="px-4 py-2 bg-[#1a1a1a] text-[#f5f0e8] text-[12px] font-medium rounded-md hover:bg-[#252520] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => handleCompileAndSubmit(inspection.id)}
                      disabled={submittingInspectionId === inspection.id}
                    >
                      {submittingInspectionId === inspection.id ? 'Submitting…' : 'Compile & Submit Package'}
                    </button>
                  </div>
                </div>
              </AccordionRow>
            ))
          )}
        </AccordionList>
      )}

      <CreateModal
        isOpen={showCreate}
        title="New Inspection"
        fields={[
          { name: 'Type', label: 'Type', type: 'select', options: INSPECTION_TYPES },
          { name: 'Date', label: 'Date', type: 'date' },
          { name: 'Start Time', label: 'Start Time', type: 'time' },
          { name: 'Duration', label: 'Duration (min)', type: 'text' },
          { name: 'Assessor', label: 'Assessor', type: 'text' },
          { name: 'Person Met', label: 'Person Met', type: 'text' },
        ]}
        onSubmit={handleCreate}
        onClose={() => setShowCreate(false)}
      />
    </>
  )
}
