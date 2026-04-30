'use client'

import React, { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
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
  created_at: string
}

interface InspectionsTabProps {
  jobId: string
  tenantId: string
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
export function InspectionsTab({ jobId, tenantId }: InspectionsTabProps) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [inspections, setInspections] = useState<Inspection[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    async function fetch() {
      setLoading(true)
      const { data } = await supabase
        .from('inspections')
        .select('id,tenant_id,job_id,inspection_ref,scheduled_date,start_time,finish_time,duration_minutes,status,person_met,access_notes,notes,field_draft,created_at')
        .eq('job_id', jobId)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true })
      setInspections((data ?? []) as Inspection[])
      setLoading(false)
    }
    fetch()
  }, [jobId, tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate(data: Record<string, string>) {
    const fieldDraft = { type: data['Type'] ?? '' }
    const startTime = data['Start Time'] || null
    const duration = parseInt(data['Duration'] || '60') || 60
    const finishTime = startTime ? calculateFinishTime(startTime, duration.toString()) : null
    
    const { data: inserted, error } = await supabase
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
      .select('id,tenant_id,job_id,inspection_ref,scheduled_date,start_time,finish_time,duration_minutes,status,person_met,access_notes,notes,field_draft,created_at')
      .single()
    if (error) throw error
    setInspections(prev => [...prev, inserted as Inspection])
  }

  function handleDelete(id: string) {
    setInspections(prev => prev.filter(i => i.id !== id))
  }

  const typeLabel = (insp: Inspection) => {
    const draft = insp.field_draft as Record<string, unknown> | null
    return (draft?.type as string | undefined) || '—'
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
          {inspections.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-[#9e998f]">
              No inspections yet
            </div>
          ) : (
            inspections.map(insp => (
              <AccordionRow
                key={insp.id}
                summary={
                  <div className="flex items-center gap-3 flex-wrap">
                    <span
                      className="text-[13px] font-medium"
                      style={{ fontFamily: 'DM Mono, monospace', color: '#c8b89a' }}
                    >
                      {insp.inspection_ref ?? '—'}
                    </span>
                    <span className="text-[13px] text-[#3a3530]">{typeLabel(insp)}</span>
                    <span className="text-[12px] text-[#9e998f]">{formatDate(insp.scheduled_date)}</span>
                    {insp.start_time && (
                      <span className="text-[12px] text-[#9e998f]">{formatTime(insp.start_time)}</span>
                    )}
                    {insp.access_notes && (
                      <span className="text-[12px] text-[#9e998f]">{insp.access_notes}</span>
                    )}
                    {insp.person_met && (
                      <span className="text-[12px] text-[#9e998f]">{insp.person_met}</span>
                    )}
                    <StatusPill status={insp.status} />
                  </div>
                }
              >
                <InspectionForm
                  inspection={insp}
                  tenantId={tenantId}
                  onDelete={handleDelete}
                />
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
