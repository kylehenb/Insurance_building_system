'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Plus, FileText } from 'lucide-react'
import { ReportAccordionItem } from './ReportAccordionItem'

// — Types ——————————————————————————————————————————————————————————
interface Report {
  id: string
  tenant_id: string
  job_id: string
  report_ref: string
  report_type: 'BAR' | 'storm_wind' | 'make_safe' | 'roof' | 'specialist' | 'LDR'
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

type NewReportType = 'BAR' | 'make_safe' | 'roof' | 'specialist' | 'LDR'

interface ReportsTabProps {
  jobId: string
  tenantId: string
  currentUserId: string
  currentUserRole: string
}

const REPORT_TYPE_OPTIONS: { value: NewReportType; label: string }[] = [
  { value: 'BAR', label: 'BAR' },
  { value: 'make_safe', label: 'Make Safe' },
  { value: 'roof', label: 'Roof Report' },
  { value: 'specialist', label: 'Specialist Report' },
]

// — Component ——————————————————————————————————————————————————————
export function ReportsTab({
  jobId,
  tenantId,
  currentUserId,
  currentUserRole,
}: ReportsTabProps) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewReportMenu, setShowNewReportMenu] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  const isAdmin = currentUserRole === 'admin'

  // — Fetch ————————————————————————————————————————————————————————
  const fetchReports = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .eq('job_id', jobId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })

    if (!error && data) {
      const visible = isAdmin
        ? data
        : data.filter((r: Report) => !r.deleted_at)
      setReports(visible as Report[])
    }
    setLoading(false)
  }, [jobId, tenantId, supabase, isAdmin])

  useEffect(() => {
    fetchReports()
  }, [fetchReports])

  // — Create new report ————————————————————————————————————————————
  const handleCreateReport = async (type: NewReportType) => {
    setShowNewReportMenu(false)
    setIsCreating(true)

    const { data: jobRow } = await supabase
      .from('jobs')
      .select('job_number')
      .eq('id', jobId)
      .single()

    const jobNumber = jobRow?.job_number ?? 'UNKNOWN'
    const existingCount = reports.length
    const newIndex = String(existingCount + 1).padStart(3, '0')
    const newRef = `RPT-${jobNumber}-${newIndex}`

    const { data: newReport, error } = await supabase
      .from('reports')
      .insert({
        tenant_id: tenantId,
        job_id: jobId,
        report_ref: newRef,
        report_type: type,
        status: 'draft',
        is_locked: false,
        version: 1,
        type_specific_fields: {},
      })
      .select()
      .single()

    if (!error && newReport) {
      setReports(prev => [...prev, newReport as Report])
    }

    setIsCreating(false)
  }

  // — Handlers from child ——————————————————————————————————————————
  const handleReportUpdate = (id: string, changes: Partial<Report>) => {
    setReports(prev => prev.map(r => (r.id === id ? { ...r, ...changes } : r)))
  }

  const handleReportDeleted = (id: string) => {
    if (isAdmin) {
      setReports(prev =>
        prev.map(r => (r.id === id ? { ...r, deleted_at: new Date().toISOString() } : r))
      )
    } else {
      setReports(prev => prev.filter(r => r.id !== id))
    }
  }

  const handleReportDuplicated = (newReport: Report) => {
    setReports(prev => [...prev, newReport])
  }

  const handleReportReinstated = (id: string) => {
    setReports(prev =>
      prev.map(r =>
        r.id === id ? { ...r, deleted_at: null, deleted_by: null, delete_reason: null } : r
      )
    )
  }

  // — Render —————————————————————————————————————————————————————————
  return (
    <div className="px-0 py-2">
      <div className="flex items-center justify-between mb-4">
        <span
          className="text-[11px] text-[#b0a898] uppercase tracking-widest"
          style={{ fontFamily: 'DM Sans, sans-serif' }}
        >
          {reports.filter(r => !r.deleted_at).length} report
          {reports.filter(r => !r.deleted_at).length !== 1 ? 's' : ''}
        </span>

        <div className="relative">
          <button
            onClick={() => setShowNewReportMenu(o => !o)}
            disabled={isCreating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium text-[#3a3530] border border-[#e4dfd8] bg-white hover:bg-[#f5f2ee] transition-colors"
            style={{ fontFamily: 'DM Sans, sans-serif' }}
          >
            <Plus size={13} />
            {isCreating ? 'Creating…' : 'Add Report'}
          </button>

          {showNewReportMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowNewReportMenu(false)} />
              <div
                className="absolute right-0 top-full mt-1 z-20 w-44 rounded-lg shadow-lg overflow-hidden"
                style={{ background: '#ffffff', border: '0.5px solid #e4dfd8' }}
              >
                {REPORT_TYPE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => handleCreateReport(opt.value)}
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-[12px] text-[#3a3530] hover:bg-[#f5f2ee] transition-colors text-left"
                    style={{ fontFamily: 'DM Sans, sans-serif' }}
                  >
                    <FileText size={12} className="text-[#b0a898]" />
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map(i => (
            <div
              key={i}
              className="h-12 rounded-lg animate-pulse"
              style={{ background: '#f0ece6' }}
            />
          ))}
        </div>
      ) : reports.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-12 text-center"
          style={{ border: '0.5px dashed #e4dfd8', borderRadius: 10 }}
        >
          <FileText size={24} className="text-[#e4dfd8] mb-3" />
          <p
            className="text-[13px] text-[#b0a898]"
            style={{ fontFamily: 'DM Sans, sans-serif' }}
          >
            No reports yet
          </p>
          <p
            className="text-[11px] text-[#c8bfb4] mt-1"
            style={{ fontFamily: 'DM Sans, sans-serif' }}
          >
            Reports are auto-created when a field app is submitted, or add one manually above.
          </p>
        </div>
      ) : (
        <div>
          {reports.map(report => (
            <ReportAccordionItem
              key={report.id}
              report={report}
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
              isAdmin={isAdmin}
              onReportUpdate={handleReportUpdate}
              onReportDeleted={handleReportDeleted}
              onReportDuplicated={handleReportDuplicated}
              onReportReinstated={handleReportReinstated}
              jobId={jobId}
            />
          ))}
        </div>
      )}
    </div>
  )
}
