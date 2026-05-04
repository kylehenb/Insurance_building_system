'use client'

import React, { useState, useCallback, useEffect } from 'react'
import {
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  FileText,
  Lock,
  Unlock,
  Clock,
  Copy,
  Trash2,
  RotateCcw,
} from 'lucide-react'
import { createBrowserClient } from '@supabase/ssr'
import { BARReportForm } from './BARReportForm'
import { RoofReportForm } from './RoofReportForm'
import { MakeSafeReportForm } from './MakeSafeReportForm'
import { useReportAutosave } from './useReportAutosave'
import { PropertyDetails, parsePropertyDetails } from '@/lib/types/property-details'

// — Types ——————————————————————————————————————————————————————————
interface Report {
  id: string
  tenant_id: string
  job_id: string
  report_ref: string
  report_type: 'BAR' | 'storm_wind' | 'make_safe' | 'roof' | 'specialist'
  status: string
  is_locked: boolean
  version: number
  attendance_date: string | null
  attendance_time: string | null
  person_met: string | null
  assessor_name: string | null
  property_address: string | null
  insured_name: string | null
  claim_number: string | null
  loss_type: string | null
  property_description: string | null
  incident_description: string | null
  cause_of_damage: string | null
  how_damage_occurred: string | null
  resulting_damage: string | null
  conclusion: string | null
  pre_existing_conditions: string | null
  maintenance_notes: string | null
  raw_report_dump: string | null
  damage_template: string | null
  additional_notes: string | null
  type_specific_fields: Record<string, unknown>
  pdf_storage_path: string | null
  deleted_at: string | null
  delete_reason: string | null
  created_at: string
}

interface ReportAccordionItemProps {
  report: Report
  currentUserId: string
  currentUserRole: string
  isAdmin: boolean
  onReportUpdate: (id: string, changes: Partial<Report>) => void
  onReportDeleted: (id: string) => void
  onReportDuplicated: (newReport: Report) => void
  onReportReinstated: (id: string) => void
  jobId: string
}

// — Helpers ————————————————————————————————————————————————————————
const TYPE_LABELS: Record<string, string> = {
  BAR: 'BAR',
  storm_wind: 'Storm & Wind',
  make_safe: 'Make Safe',
  roof: 'Roof Report',
  specialist: 'Specialist Report',
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-amber-50 text-amber-700 border border-amber-200',
  complete: 'bg-blue-50 text-blue-700 border border-blue-200',
  sent: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  'PDF Generated': 'bg-emerald-50 text-emerald-700 border border-emerald-200',
}

function statusLabel(status: string) {
  if (status === 'sent') return 'Sent'
  if (status === 'complete') return 'Complete'
  if (status === 'PDF Generated') return 'PDF Generated'
  return 'Draft'
}

function formatDate(d: string | null) {
  if (!d) return '—'
  try {
    const dt = new Date(d)
    return dt.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return d
  }
}

// — Delete modal ———————————————————————————————————————————————————
function DeleteModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: (reason: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden"
        style={{ border: '0.5px solid #e4dfd8' }}
      >
        <div className="px-6 py-5">
          <h3
            className="text-[14px] font-semibold text-[#3a3530] mb-1"
            style={{ fontFamily: 'DM Sans, sans-serif' }}
          >
            Delete Report
          </h3>
          <p
            className="text-[12px] text-[#b0a898] mb-4"
            style={{ fontFamily: 'DM Sans, sans-serif' }}
          >
            The report will be soft-deleted and remain visible in the list. An admin can reinstate it.
          </p>
          <label
            className="block text-[10px] font-semibold tracking-[0.14em] uppercase text-[#b0a898] mb-1"
            style={{ fontFamily: 'DM Sans, sans-serif' }}
          >
            Reason for deleting
          </label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-md border border-[#e4dfd8] text-[13px] text-[#3a3530] resize-none focus:outline-none focus:border-[#c8b89a]"
            placeholder="e.g. Created in error, duplicate entry..."
            style={{ fontFamily: 'DM Sans, sans-serif' }}
          />
        </div>
        <div className="flex border-t border-[#e4dfd8]">
          <button
            onClick={onCancel}
            className="flex-1 py-3 text-[13px] text-[#9a9088] hover:bg-[#f9f7f5] transition-colors"
            style={{ fontFamily: 'DM Sans, sans-serif' }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason)}
            className="flex-1 py-3 text-[13px] font-medium text-red-600 hover:bg-red-50 transition-colors border-l border-[#e4dfd8]"
            style={{ fontFamily: 'DM Sans, sans-serif' }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// — Main component —————————————————————————————————————————————————
export function ReportAccordionItem({
  report: initialReport,
  currentUserId,
  currentUserRole: _role,
  isAdmin,
  onReportUpdate,
  onReportDeleted,
  onReportDuplicated,
  onReportReinstated,
  jobId,
}: ReportAccordionItemProps) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [report, setReport] = useState<Report>(initialReport)
  const [isOpen, setIsOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [isActioning, setIsActioning] = useState(false)

  // Property details state
  const [propertyDetails, setPropertyDetails] = useState<PropertyDetails>({})
  const [propertyDetailsLoading, setPropertyDetailsLoading] = useState(true)
  const [propertyDetailsSaveState, setPropertyDetailsSaveState] = useState<{
    status: 'idle' | 'saving' | 'saved' | 'error'
  }>({ status: 'idle' })

  // Fetch job with property_details when accordion opens
  useEffect(() => {
    if (isOpen && !propertyDetailsLoading) return
    if (!isOpen) return

    const fetchJobPropertyDetails = async () => {
      setPropertyDetailsLoading(true)
      const { data: job } = await supabase
        .from('jobs')
        .select('id, job_number, property_details')
        .eq('id', report.job_id)
        .eq('tenant_id', report.tenant_id)
        .single()

      const parsed = parsePropertyDetails(job?.property_details)
      setPropertyDetails(parsed)
      setPropertyDetailsLoading(false)
    }

    fetchJobPropertyDetails()
  }, [isOpen, report.job_id, report.tenant_id, supabase, propertyDetailsLoading])

  // Save property details to jobs table
  const savePropertyDetails = async (updates: PropertyDetails) => {
    setPropertyDetailsSaveState({ status: 'saving' })

    const { error } = await supabase
      .from('jobs')
      .update({ property_details: updates })
      .eq('id', report.job_id)
      .eq('tenant_id', report.tenant_id)

    if (error) {
      console.error('[PropertyDetails] Error:', error)
      setPropertyDetailsSaveState({ status: 'error' })
      setTimeout(() => setPropertyDetailsSaveState({ status: 'idle' }), 2000)
      return
    }

    setPropertyDetailsSaveState({ status: 'saved' })
    setTimeout(() => setPropertyDetailsSaveState({ status: 'idle' }), 2000)
  }

  // Debounced property details save
  const propertyDetailsDebounceRef = React.useRef<NodeJS.Timeout | null>(null)
  const handlePropertyDetailChange = useCallback(
    (field: keyof PropertyDetails, value: string | boolean) => {
      setPropertyDetails(prev => ({ ...prev, [field]: value }))

      if (propertyDetailsDebounceRef.current) {
        clearTimeout(propertyDetailsDebounceRef.current)
      }

      propertyDetailsDebounceRef.current = setTimeout(() => {
        savePropertyDetails({ ...propertyDetails, [field]: value })
      }, 1500)
    },
    [propertyDetails, savePropertyDetails]
  )

  const currentSnapshot = {
    attendance_date: report.attendance_date,
    attendance_time: report.attendance_time,
    person_met: report.person_met,
    assessor_name: report.assessor_name,
    property_address: report.property_address,
    insured_name: report.insured_name,
    claim_number: report.claim_number,
    loss_type: report.loss_type,
    incident_description: report.incident_description,
    cause_of_damage: report.cause_of_damage,
    how_damage_occurred: report.how_damage_occurred,
    resulting_damage: report.resulting_damage,
    conclusion: report.conclusion,
    pre_existing_conditions: report.pre_existing_conditions,
    maintenance_notes: report.maintenance_notes,
    raw_report_dump: report.raw_report_dump,
    additional_notes: report.additional_notes,
    type_specific_fields: report.type_specific_fields,
  }

  const { scheduleFieldSave, saveState } = useReportAutosave({
    reportId: report.id,
    tenantId: report.tenant_id,
    userId: currentUserId,
    currentSnapshot,
  })

  const handleFieldChange = useCallback(
    (field: string, value: unknown) => {
      setReport(prev => ({ ...prev, [field]: value }))
      scheduleFieldSave(field, value)
    },
    [scheduleFieldSave]
  )

  // Soft deleted — render collapsed red tile, no expand
  if (report.deleted_at) {
    return (
      <div
        className="rounded-lg overflow-hidden mb-2"
        style={{ border: '0.5px solid #fca5a5', background: '#fff5f5' }}
      >
        <div className="flex items-center gap-3 px-5 py-3">
          <span
            className="text-[12px] font-semibold text-red-400"
            style={{ fontFamily: 'DM Mono, monospace' }}
          >
            {report.report_ref}
          </span>
          <span
            className="text-[12px] font-medium text-red-400"
            style={{ fontFamily: 'DM Sans, sans-serif' }}
          >
            {TYPE_LABELS[report.report_type] ?? report.report_type}
          </span>
          <span
            className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-500 border border-red-200"
            style={{ fontFamily: 'DM Sans, sans-serif' }}
          >
            Deleted
          </span>
          {report.delete_reason && (
            <span
              className="text-[11px] text-red-300 ml-2"
              style={{ fontFamily: 'DM Sans, sans-serif' }}
            >
              — {report.delete_reason}
            </span>
          )}
          {isAdmin && (
            <button
              onClick={async () => {
                setIsActioning(true)
                await fetch(`/api/reports/${report.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'reinstate',
                    userId: currentUserId,
                    tenantId: report.tenant_id,
                  }),
                })
                onReportReinstated(report.id)
                setIsActioning(false)
              }}
              disabled={isActioning}
              className="ml-auto text-[11px] font-medium text-red-500 hover:text-red-700 flex items-center gap-1 transition-colors"
              style={{ fontFamily: 'DM Sans, sans-serif' }}
            >
              <RotateCcw size={12} />
              Reinstate
            </button>
          )}
        </div>
      </div>
    )
  }

  const isLocked = report.is_locked
  const cardBorderColor = isLocked ? '#86efac' : '#e4dfd8'
  const cardBgColor = isLocked ? '#f0fdf4' : '#ffffff'
  const headerBgColor = isLocked ? '#f0fdf4' : '#fdfdfc'

  return (
    <>
      {showDeleteModal && (
        <DeleteModal
          onConfirm={async reason => {
            setShowDeleteModal(false)
            setIsActioning(true)
            await fetch(`/api/reports/${report.id}`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: currentUserId,
                tenantId: report.tenant_id,
                reason,
              }),
            })
            onReportDeleted(report.id)
            setIsActioning(false)
          }}
          onCancel={() => setShowDeleteModal(false)}
        />
      )}

      <div
        className="rounded-lg overflow-hidden mb-2 transition-all duration-200"
        style={{ border: `0.5px solid ${cardBorderColor}`, background: cardBgColor }}
      >
        {/* — Header row (always visible) — */}
        <div
          className="flex items-center gap-3 px-5 py-3 select-none"
          style={{ background: headerBgColor, borderBottom: isOpen ? `0.5px solid ${cardBorderColor}` : 'none' }}
        >
          <button
            onClick={() => setIsOpen(o => !o)}
            className="flex items-center gap-3 flex-1 text-left group"
          >
            <span
              className="text-[12px] font-semibold text-[#c8b89a] hover:text-[#b0a070] transition-colors"
              style={{ fontFamily: 'DM Mono, monospace' }}
            >
              {report.report_ref}
            </span>
            <span
              className="text-[12px] font-medium text-[#3a3530]"
              style={{ fontFamily: 'DM Sans, sans-serif' }}
            >
              {TYPE_LABELS[report.report_type] ?? report.report_type}
            </span>
            {report.attendance_date && (
              <span
                className="text-[12px] text-[#b0a898]"
                style={{ fontFamily: 'DM Sans, sans-serif' }}
              >
                {formatDate(report.attendance_date)}
              </span>
            )}
            {report.person_met && (
              <span
                className="text-[12px] text-[#b0a898]"
                style={{ fontFamily: 'DM Sans, sans-serif' }}
              >
                {report.person_met}
              </span>
            )}
          </button>

          <div className="flex items-center gap-2 ml-auto">
            {saveState.status === 'saving' && (
              <span className="text-[10px] text-[#b0a898]" style={{ fontFamily: 'DM Sans, sans-serif' }}>
                Saving…
              </span>
            )}
            {saveState.status === 'saved' && (
              <span className="text-[10px] text-emerald-500" style={{ fontFamily: 'DM Sans, sans-serif' }}>
                Saved
              </span>
            )}

            {isLocked && (
              <span className="flex items-center gap-1 text-[11px] text-emerald-600">
                <Lock size={11} />
              </span>
            )}

            <span
              className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium ${STATUS_STYLES[report.status] ?? 'bg-gray-50 text-gray-500 border border-gray-200'}`}
              style={{ fontFamily: 'DM Sans, sans-serif' }}
            >
              {statusLabel(report.status)}
            </span>

            {/* 3-dot menu */}
            <div className="relative">
              <button
                onClick={e => {
                  e.stopPropagation()
                  setMenuOpen(o => !o)
                }}
                className="p-1.5 rounded-md text-[#b0a898] hover:text-[#3a3530] hover:bg-[#f0ece6] transition-colors"
              >
                <MoreHorizontal size={15} />
              </button>

              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div
                    className="absolute right-0 top-full mt-1 z-20 w-48 rounded-lg shadow-lg overflow-hidden"
                    style={{ background: '#ffffff', border: '0.5px solid #e4dfd8' }}
                  >
                    {!isLocked ? (
                      <button
                        onClick={async () => {
                          setMenuOpen(false)
                          setIsActioning(true)
                          await fetch(`/api/reports/${report.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'lock', userId: currentUserId, tenantId: report.tenant_id }),
                          })
                          const updated = { ...report, is_locked: true }
                          setReport(updated)
                          onReportUpdate(report.id, { is_locked: true })
                          setIsActioning(false)
                        }}
                        className="flex items-center gap-2.5 w-full px-4 py-2.5 text-[12px] text-[#3a3530] hover:bg-[#f5f2ee] transition-colors text-left"
                        style={{ fontFamily: 'DM Sans, sans-serif' }}
                      >
                        <Lock size={13} className="text-[#b0a898]" />
                        Lock report
                      </button>
                    ) : (
                      <button
                        onClick={async () => {
                          setMenuOpen(false)
                          setIsActioning(true)
                          await fetch(`/api/reports/${report.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'unlock', userId: currentUserId, tenantId: report.tenant_id }),
                          })
                          setReport(r => ({ ...r, is_locked: false }))
                          onReportUpdate(report.id, { is_locked: false })
                          setIsActioning(false)
                        }}
                        className="flex items-center gap-2.5 w-full px-4 py-2.5 text-[12px] text-[#3a3530] hover:bg-[#f5f2ee] transition-colors text-left"
                        style={{ fontFamily: 'DM Sans, sans-serif' }}
                      >
                        <Unlock size={13} className="text-[#b0a898]" />
                        Unlock report
                      </button>
                    )}

                    <button
                      onClick={() => {
                        setMenuOpen(false)
                        alert('Recent changes — coming soon')
                      }}
                      className="flex items-center gap-2.5 w-full px-4 py-2.5 text-[12px] text-[#3a3530] hover:bg-[#f5f2ee] transition-colors text-left"
                      style={{ fontFamily: 'DM Sans, sans-serif' }}
                    >
                      <Clock size={13} className="text-[#b0a898]" />
                      Recent changes
                      <span className="ml-auto text-[10px] text-[#b0a898]">Soon</span>
                    </button>

                    <button
                      onClick={async () => {
                        setMenuOpen(false)
                        setIsActioning(true)
                        const res = await fetch(`/api/reports/${report.id}`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ userId: currentUserId, tenantId: report.tenant_id }),
                        })
                        const data = await res.json()
                        if (data.report) onReportDuplicated(data.report)
                        setIsActioning(false)
                      }}
                      className="flex items-center gap-2.5 w-full px-4 py-2.5 text-[12px] text-[#3a3530] hover:bg-[#f5f2ee] transition-colors text-left"
                      style={{ fontFamily: 'DM Sans, sans-serif' }}
                    >
                      <Copy size={13} className="text-[#b0a898]" />
                      Duplicate report
                    </button>

                    <div style={{ borderTop: '0.5px solid #e4dfd8' }} />

                    <button
                      onClick={() => {
                        setMenuOpen(false)
                        setShowDeleteModal(true)
                      }}
                      className="flex items-center gap-2.5 w-full px-4 py-2.5 text-[12px] text-red-500 hover:bg-red-50 transition-colors text-left"
                      style={{ fontFamily: 'DM Sans, sans-serif' }}
                    >
                      <Trash2 size={13} />
                      Delete report
                    </button>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={() => setIsOpen(o => !o)}
              className="p-1.5 rounded-md text-[#b0a898] hover:text-[#3a3530] hover:bg-[#f0ece6] transition-colors"
            >
              {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
          </div>
        </div>

        {/* — Expanded body — */}
        {isOpen && (
          <div className="px-6 pb-6">
            {isLocked && (
              <div className="flex items-center gap-2 mt-4 mb-2 px-3 py-2 rounded-md bg-emerald-50 border border-emerald-200">
                <Lock size={12} className="text-emerald-600" />
                <span
                  className="text-[11px] text-emerald-700"
                  style={{ fontFamily: 'DM Sans, sans-serif' }}
                >
                  This report is locked. Unlock it from the menu to make edits.
                </span>
              </div>
            )}

            {/* — Property Details Section — */}
            <div
              className="mt-4 mb-6 p-5 rounded-lg"
              style={{
                background: '#faf8f5',
                borderLeft: '2px solid #c8b89a',
                border: '0.5px solid #e4dfd8',
              }}
            >
              <div className="mb-4">
                <h3
                  className="text-[12px] font-semibold text-[#3a3530] mb-1"
                  style={{ fontFamily: 'DM Sans, sans-serif' }}
                >
                  Property Details
                </h3>
                <p
                  className="text-[11px] text-[#b0a898]"
                  style={{ fontFamily: 'DM Sans, sans-serif' }}
                >
                  Shared across all reports on this job — editing here updates the job record
                </p>
                {propertyDetailsSaveState.status === 'saving' && (
                  <span className="text-[10px] text-[#b0a898] ml-2" style={{ fontFamily: 'DM Sans, sans-serif' }}>
                    Saving…
                  </span>
                )}
                {propertyDetailsSaveState.status === 'saved' && (
                  <span className="text-[10px] text-emerald-500 ml-2" style={{ fontFamily: 'DM Sans, sans-serif' }}>
                    Saved
                  </span>
                )}
                {propertyDetailsSaveState.status === 'error' && (
                  <span className="text-[10px] text-red-500 ml-2" style={{ fontFamily: 'DM Sans, sans-serif' }}>
                    Error saving
                  </span>
                )}
              </div>

              {propertyDetailsLoading ? (
                <div className="h-32 rounded-lg animate-pulse" style={{ background: '#f0ece6' }} />
              ) : (
                <>
                  {/* Text fields - 2 column grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label
                        className="block text-[10px] font-semibold tracking-[0.14em] uppercase text-[#b0a898] mb-1"
                        style={{ fontFamily: 'DM Sans, sans-serif' }}
                      >
                        Building age
                      </label>
                      <input
                        type="text"
                        value={propertyDetails.building_age ?? ''}
                        onChange={e => handlePropertyDetailChange('building_age', e.target.value)}
                        disabled={isLocked}
                        className="w-full px-3 py-2 rounded-md border text-[13px] text-[#3a3530] bg-white border-[#e4dfd8] focus:outline-none focus:border-[#c8b89a] focus:ring-1 focus:ring-[#c8b89a] disabled:bg-[#f9f7f5] disabled:text-[#b0a898] disabled:cursor-not-allowed transition-colors"
                        style={{ fontFamily: 'DM Sans, sans-serif' }}
                        placeholder="e.g. ~30 years"
                      />
                    </div>
                    <div>
                      <label
                        className="block text-[10px] font-semibold tracking-[0.14em] uppercase text-[#b0a898] mb-1"
                        style={{ fontFamily: 'DM Sans, sans-serif' }}
                      >
                        Condition
                      </label>
                      <input
                        type="text"
                        value={propertyDetails.condition ?? ''}
                        onChange={e => handlePropertyDetailChange('condition', e.target.value)}
                        disabled={isLocked}
                        className="w-full px-3 py-2 rounded-md border text-[13px] text-[#3a3530] bg-white border-[#e4dfd8] focus:outline-none focus:border-[#c8b89a] focus:ring-1 focus:ring-[#c8b89a] disabled:bg-[#f9f7f5] disabled:text-[#b0a898] disabled:cursor-not-allowed transition-colors"
                        style={{ fontFamily: 'DM Sans, sans-serif' }}
                        placeholder="e.g. Good, Fair, Poor"
                      />
                    </div>
                    <div>
                      <label
                        className="block text-[10px] font-semibold tracking-[0.14em] uppercase text-[#b0a898] mb-1"
                        style={{ fontFamily: 'DM Sans, sans-serif' }}
                      >
                        Roof type
                      </label>
                      <input
                        type="text"
                        value={propertyDetails.roof_type ?? ''}
                        onChange={e => handlePropertyDetailChange('roof_type', e.target.value)}
                        disabled={isLocked}
                        className="w-full px-3 py-2 rounded-md border text-[13px] text-[#3a3530] bg-white border-[#e4dfd8] focus:outline-none focus:border-[#c8b89a] focus:ring-1 focus:ring-[#c8b89a] disabled:bg-[#f9f7f5] disabled:text-[#b0a898] disabled:cursor-not-allowed transition-colors"
                        style={{ fontFamily: 'DM Sans, sans-serif' }}
                        placeholder="e.g. Concrete tile — hip configuration"
                      />
                    </div>
                    <div>
                      <label
                        className="block text-[10px] font-semibold tracking-[0.14em] uppercase text-[#b0a898] mb-1"
                        style={{ fontFamily: 'DM Sans, sans-serif' }}
                      >
                        Wall type
                      </label>
                      <input
                        type="text"
                        value={propertyDetails.wall_type ?? ''}
                        onChange={e => handlePropertyDetailChange('wall_type', e.target.value)}
                        disabled={isLocked}
                        className="w-full px-3 py-2 rounded-md border text-[13px] text-[#3a3530] bg-white border-[#e4dfd8] focus:outline-none focus:border-[#c8b89a] focus:ring-1 focus:ring-[#c8b89a] disabled:bg-[#f9f7f5] disabled:text-[#b0a898] disabled:cursor-not-allowed transition-colors"
                        style={{ fontFamily: 'DM Sans, sans-serif' }}
                        placeholder="e.g. Brick veneer, Double brick"
                      />
                    </div>
                    <div>
                      <label
                        className="block text-[10px] font-semibold tracking-[0.14em] uppercase text-[#b0a898] mb-1"
                        style={{ fontFamily: 'DM Sans, sans-serif' }}
                      >
                        Storeys
                      </label>
                      <input
                        type="text"
                        value={propertyDetails.storeys ?? ''}
                        onChange={e => handlePropertyDetailChange('storeys', e.target.value)}
                        disabled={isLocked}
                        className="w-full px-3 py-2 rounded-md border text-[13px] text-[#3a3530] bg-white border-[#e4dfd8] focus:outline-none focus:border-[#c8b89a] focus:ring-1 focus:ring-[#c8b89a] disabled:bg-[#f9f7f5] disabled:text-[#b0a898] disabled:cursor-not-allowed transition-colors"
                        style={{ fontFamily: 'DM Sans, sans-serif' }}
                        placeholder="e.g. 1, 2"
                      />
                    </div>
                    <div>
                      <label
                        className="block text-[10px] font-semibold tracking-[0.14em] uppercase text-[#b0a898] mb-1"
                        style={{ fontFamily: 'DM Sans, sans-serif' }}
                      >
                        Foundation
                      </label>
                      <input
                        type="text"
                        value={propertyDetails.foundation ?? ''}
                        onChange={e => handlePropertyDetailChange('foundation', e.target.value)}
                        disabled={isLocked}
                        className="w-full px-3 py-2 rounded-md border text-[13px] text-[#3a3530] bg-white border-[#e4dfd8] focus:outline-none focus:border-[#c8b89a] focus:ring-1 focus:ring-[#c8b89a] disabled:bg-[#f9f7f5] disabled:text-[#b0a898] disabled:cursor-not-allowed transition-colors"
                        style={{ fontFamily: 'DM Sans, sans-serif' }}
                        placeholder="e.g. Concrete slab, Suspended timber"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label
                        className="block text-[10px] font-semibold tracking-[0.14em] uppercase text-[#b0a898] mb-1"
                        style={{ fontFamily: 'DM Sans, sans-serif' }}
                      >
                        Fence
                      </label>
                      <input
                        type="text"
                        value={propertyDetails.fence ?? ''}
                        onChange={e => handlePropertyDetailChange('fence', e.target.value)}
                        disabled={isLocked}
                        className="w-full px-3 py-2 rounded-md border text-[13px] text-[#3a3530] bg-white border-[#e4dfd8] focus:outline-none focus:border-[#c8b89a] focus:ring-1 focus:ring-[#c8b89a] disabled:bg-[#f9f7f5] disabled:text-[#b0a898] disabled:cursor-not-allowed transition-colors"
                        style={{ fontFamily: 'DM Sans, sans-serif' }}
                        placeholder="e.g. Colourbond — approx. 15 years, None"
                      />
                    </div>
                  </div>

                  {/* Boolean fields - row of checkboxes */}
                  <div className="flex flex-wrap gap-6">
                    <label className="flex items-center gap-2 text-[13px] text-[#3a3530] cursor-pointer" style={{ fontFamily: 'DM Sans, sans-serif' }}>
                      <input
                        type="checkbox"
                        checked={propertyDetails.pool ?? false}
                        onChange={e => handlePropertyDetailChange('pool', e.target.checked)}
                        disabled={isLocked}
                        className="accent-[#c8b89a]"
                      />
                      Swimming pool
                    </label>
                    <label className="flex items-center gap-2 text-[13px] text-[#3a3530] cursor-pointer" style={{ fontFamily: 'DM Sans, sans-serif' }}>
                      <input
                        type="checkbox"
                        checked={propertyDetails.detached_garage ?? false}
                        onChange={e => handlePropertyDetailChange('detached_garage', e.target.checked)}
                        disabled={isLocked}
                        className="accent-[#c8b89a]"
                      />
                      Detached garage
                    </label>
                    <label className="flex items-center gap-2 text-[13px] text-[#3a3530] cursor-pointer" style={{ fontFamily: 'DM Sans, sans-serif' }}>
                      <input
                        type="checkbox"
                        checked={propertyDetails.granny_flat ?? false}
                        onChange={e => handlePropertyDetailChange('granny_flat', e.target.checked)}
                        disabled={isLocked}
                        className="accent-[#c8b89a]"
                      />
                      Granny flat / outbuilding
                    </label>
                  </div>
                </>
              )}
            </div>

            {(report.report_type === 'BAR' || report.report_type === 'storm_wind') && (
              <BARReportForm
                data={report as unknown as Record<string, unknown>}
                locked={isLocked}
                onChange={handleFieldChange}
                tenantId={report.tenant_id}
                reportId={report.id}
                jobId={report.job_id}
              />
            )}
            {report.report_type === 'roof' && (
              <RoofReportForm
                data={report as unknown as Record<string, unknown>}
                locked={isLocked}
                onChange={handleFieldChange}
              />
            )}
            {report.report_type === 'make_safe' && (
              <MakeSafeReportForm
                data={report as unknown as Record<string, unknown>}
                locked={isLocked}
                onChange={handleFieldChange}
                tenantId={report.tenant_id}
              />
            )}
            {report.report_type === 'specialist' && (
              <div className="pt-6">
                <p
                  className="text-[12px] text-[#b0a898]"
                  style={{ fontFamily: 'DM Sans, sans-serif' }}
                >
                  Specialist report template — coming soon.
                </p>
              </div>
            )}

            {/* — Bottom action bar — */}
            <div
              className="flex items-center gap-3 mt-8 pt-5"
              style={{ borderTop: '0.5px solid #e4dfd8' }}
            >
              <button
                onClick={() => {
                  window.open(`/print/reports/${report.id}`, '_blank')
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-md text-[12px] font-medium text-white transition-colors"
                style={{ background: '#c8b89a', fontFamily: 'DM Sans, sans-serif' }}
              >
                <FileText size={13} />
                Preview Report PDF
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
