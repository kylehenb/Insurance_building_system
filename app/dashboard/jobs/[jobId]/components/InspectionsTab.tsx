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
  scheduled_time: string | null
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
  const [time, setTime] = useState(inspection.scheduled_time ?? '')
  const [status, setStatus] = useState(inspection.status)
  const [personMet, setPersonMet] = useState(inspection.person_met ?? '')
  const [assessor, setAssessor] = useState(inspection.access_notes ?? '')
  const [notes, setNotes] = useState(inspection.notes ?? '')
  const [deleting, setDeleting] = useState(false)

  const { scheduleFieldSave, flushSave, saveState } = useInspectionAutosave({
    inspectionId: inspection.id,
    tenantId,
  })

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
          <label style={labelStyle}>Time</label>
          <input
            type="time"
            value={time}
            style={inputStyle}
            onChange={e => handleChange('scheduled_time', e.target.value, setTime)}
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
        .select('id,tenant_id,job_id,inspection_ref,scheduled_date,scheduled_time,status,person_met,access_notes,notes,field_draft,created_at')
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
    const { data: inserted, error } = await supabase
      .from('inspections')
      .insert({
        tenant_id: tenantId,
        job_id: jobId,
        status: 'draft',
        scheduled_date: data['Date'] || null,
        scheduled_time: data['Time'] || null,
        access_notes: data['Assessor'] || null,
        person_met: data['Person Met'] || null,
        field_draft: fieldDraft,
      })
      .select('id,tenant_id,job_id,inspection_ref,scheduled_date,scheduled_time,status,person_met,access_notes,notes,field_draft,created_at')
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
                    {insp.scheduled_time && (
                      <span className="text-[12px] text-[#9e998f]">{formatTime(insp.scheduled_time)}</span>
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
          { name: 'Time', label: 'Time', type: 'time' },
          { name: 'Assessor', label: 'Assessor', type: 'text' },
          { name: 'Person Met', label: 'Person Met', type: 'text' },
        ]}
        onSubmit={handleCreate}
        onClose={() => setShowCreate(false)}
      />
    </>
  )
}
