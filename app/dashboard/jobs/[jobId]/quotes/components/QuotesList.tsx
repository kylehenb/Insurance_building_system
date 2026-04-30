'use client'

import React, { useCallback, useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { QuoteEditorClient } from './QuoteEditorClient'

// ─── Types ───────────────────────────────────────────────────────────────────

interface JobInfo {
  job_number: string
  insurer: string | null
  insured_name: string | null
  property_address: string | null
}

interface RoomSummary {
  count: number
  subtotal: number
}

interface QuoteListItem {
  id: string
  quote_ref: string | null
  status: string
  version: number
  total_amount: number | null
  markup_pct: number
  gst_pct: number
  is_locked: boolean
  created_at: string
  item_count: number
  room_summary: Record<string, RoomSummary>
  approval_notes: string | null
}

interface ActionConfig {
  label: string
  inactive?: boolean
  action:
    | 'expand_quote'
    | 'send_quote_email'
    | 'send_contracts_email'
    | 'file_upload'
    | 'navigate_work_orders'
    | 'navigate_invoices'
    | 'not_yet_built'
    | 'inactive'
}

// ─── Status constants ─────────────────────────────────────────────────────────

const STATUS_ORDER = [
  'draft',
  'ready',
  'sent',
  'approved',
  'partially_approved',
  'rejected',
]

const STATUS_LABELS: Record<string, string> = {
  draft:             'Draft',
  ready:             'Ready',
  sent:              'Sent to insurer',
  approved:          'Approved',
  partially_approved:'Partially Approved',
  rejected:          'Rejected',
}

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  draft:             { bg: '#fff8e1', text: '#b45309' },
  ready:             { bg: '#e8f5e9', text: '#2e7d32' },
  sent:              { bg: '#e8f0fe', text: '#1a73e8' },
  approved:          { bg: '#e8f5e9', text: '#2e7d32' },
  partially_approved:{ bg: '#fff3e0', text: '#e65100' },
  rejected:          { bg: '#fce8e6', text: '#c5221f' },
}

const STATUS_ACTIONS: Record<string, ActionConfig> = {
  draft:             { label: 'Complete quote',              action: 'expand_quote' },
  ready:             { label: 'Send quote',                  action: 'send_quote_email' },
  sent:              { label: 'Waiting on insurer',          action: 'inactive', inactive: true },
  approved:          { label: 'View work orders',            action: 'navigate_work_orders' },
  partially_approved:{ label: 'View work orders',            action: 'navigate_work_orders' },
  rejected:          { label: 'Closed',                      action: 'inactive', inactive: true },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeStatus(status: string): string {
  return (status ?? 'draft').toLowerCase()
}

function getStatusIndex(status: string): number {
  return STATUS_ORDER.indexOf(normalizeStatus(status))
}

function fmt(v: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface QuotesListProps {
  jobId: string
  tenantId: string
  insurer: string | null
  job: JobInfo
  onQuoteUpdated?: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function QuotesList({ jobId, tenantId, insurer, job, onQuoteUpdated }: QuotesListProps) {
  const router = useRouter()

  const [quotes, setQuotes]               = useState<QuoteListItem[]>([])
  const [loading, setLoading]             = useState(true)
  const [expandedId, setExpandedId]       = useState<string | null>(null)
  const [creating, setCreating]           = useState(false)
  const [menuDropdownId, setMenuDropdownId] = useState<string | null>(null)
  const [notBuiltVisible, setNotBuiltVisible]   = useState(false)
  const [fileUploadVisible, setFileUploadVisible] = useState(false)
  const [sowLoading, setSowLoading]       = useState<string | null>(null)
  const [cloningQuoteId, setCloningQuoteId] = useState<string | null>(null)
  const [showCloneDialog, setShowCloneDialog] = useState<string | null>(null)
  const initialLoadDone = useRef(false)

  // New workflow state
  const [sendDialogQuoteId, setSendDialogQuoteId] = useState<string | null>(null)
  const [declineDialogQuoteId, setDeclineDialogQuoteId] = useState<string | null>(null)
  const [declineOption, setDeclineOption] = useState<string | null>(null)
  const [approveDialogQuoteId, setApproveDialogQuoteId] = useState<string | null>(null)
  const [partialApproveDialogQuoteId, setPartialApproveDialogQuoteId] = useState<string | null>(null)
  const [selectedLineItems, setSelectedLineItems] = useState<string[]>([])
  const [quoteLineItems, setQuoteLineItems] = useState<any[]>([])
  const [sendForSignatureQuoteId, setSendForSignatureQuoteId] = useState<string | null>(null)
  const [receiveSignOffVisible, setReceiveSignOffVisible] = useState(false)
  const [currentJobStage, setCurrentJobStage] = useState<string | null>(null)
  const [signOffFiledDate, setSignOffFiledDate] = useState<Date | null>(null)

  // Version history state
  const [showVersions, setShowVersions] = useState<string | null>(null)
  const [versionsMap, setVersionsMap] = useState<Record<string, any[]>>({})
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [reverting, setReverting] = useState<string | null>(null)
  const versionDropdownRefs = useRef<Record<string, HTMLDivElement>>({})

  // Preview modal state
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [previewQuoteId, setPreviewQuoteId] = useState<string | null>(null)
  const [previewData, setPreviewData] = useState<any>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  // ── Data loading ─────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    // Only show the loading spinner on the very first load.
    // Background refreshes (e.g. after a status change inside the inline editor)
    // must not unmount the editor, otherwise pending debounced item saves are killed.
    const isFirst = !initialLoadDone.current
    if (isFirst) setLoading(true)
    try {
      const res = await fetch(`/api/quotes?jobId=${jobId}&tenantId=${tenantId}`)
      if (res.ok) {
        const data: QuoteListItem[] = await res.json()
        setQuotes(data)
      }
    } finally {
      if (isFirst) setLoading(false)
      initialLoadDone.current = true
    }
  }, [jobId, tenantId])

  useEffect(() => { load() }, [load])

  // ── Fetch current job stage ───────────────────────────────────────────────

  useEffect(() => {
    const fetchJobStage = async () => {
      try {
        const supabase = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        )
        const { data } = await supabase
          .from('jobs')
          .select('current_stage, homeowner_signoff_received_at')
          .eq('id', jobId)
          .single()
        setCurrentJobStage((data as any)?.current_stage ?? null)
        const receivedAt = (data as any)?.homeowner_signoff_received_at
        if (receivedAt) setSignOffFiledDate(new Date(receivedAt))
      } catch (error) {
        console.error('Error fetching job stage:', error)
      }
    }
    fetchJobStage()
  }, [jobId])

  // ── Close dropdown on outside click ──────────────────────────────────────

  useEffect(() => {
    if (!menuDropdownId) return
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-menu-dropdown]')) {
        setMenuDropdownId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuDropdownId])

  // ── Version dropdown: fetch versions when opened ─────────────────────────────

  useEffect(() => {
    if (!showVersions) return
    const quoteId = showVersions
    setLoadingVersions(true)
    fetch(`/api/quotes/${quoteId}/versions?tenantId=${encodeURIComponent(tenantId)}`)
      .then(r => r.json())
      .then((data: any[]) => {
        setVersionsMap(prev => ({ ...prev, [quoteId]: data }))
      })
      .catch(() => {
        setVersionsMap(prev => ({ ...prev, [quoteId]: [] }))
      })
      .finally(() => setLoadingVersions(false))
  }, [showVersions, tenantId])

  // ── Version dropdown: close on outside click ────────────────────────────────

  useEffect(() => {
    if (!showVersions) return
    const handler = (e: MouseEvent) => {
      const ref = versionDropdownRefs.current[showVersions]
      if (ref && !ref.contains(e.target as Node)) {
        setShowVersions(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showVersions])

  // ── Create / delete ───────────────────────────────────────────────────────

  const handleCreate = useCallback(async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, tenantId, quoteType: 'additional_works' }),
      })
      if (!res.ok) throw new Error('Failed')
      const q: QuoteListItem = await res.json()
      setQuotes(prev => [
        ...prev,
        { ...q, room_summary: q.room_summary ?? {}, item_count: q.item_count ?? 0 },
      ])
      setExpandedId(q.id)
    } catch {
      alert('Failed to create quote. Please try again.')
    } finally {
      setCreating(false)
    }
  }, [jobId, tenantId])

  const handleDelete = useCallback(
    async (quoteId: string, quoteRef: string | null) => {
      if (!window.confirm(`Delete quote ${quoteRef ?? 'this quote'}? This cannot be undone.`)) return
      const res = await fetch(`/api/quotes/${quoteId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      if (res.ok) {
        setQuotes(prev => prev.filter(q => q.id !== quoteId))
        if (expandedId === quoteId) setExpandedId(null)
      }
    },
    [tenantId, expandedId]
  )

  const handleClone = useCallback(
    async (quoteId: string, cloneType: 'version' | 'new_quote') => {
      setCloningQuoteId(quoteId)
      setShowCloneDialog(null)
      try {
        const response = await fetch(`/api/quotes/${quoteId}/clone`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, cloneType }),
        })
        if (response.ok) {
          const newQuote = await response.json()
          // Reload quotes list and expand the new quote
          await load()
          setExpandedId(newQuote.id)
          setTimeout(() => {
            const el = document.getElementById(`quote-editor-${newQuote.id}`)
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }, 150)
        }
      } catch (error) {
        console.error('Error cloning quote:', error)
        alert('Failed to clone quote. Please try again.')
      } finally {
        setCloningQuoteId(null)
      }
    },
    [tenantId, load]
  )

  // ── File upload handler ───────────────────────────────────────────────────────

  const handleFileUpload = useCallback(
    async (files: File[]) => {
      try {
        const supabase = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        )

        for (const file of files) {
          const fileExt = file.name.split('.').pop()
          const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
          const filePath = `tenants/${tenantId}/jobs/${jobId}/docs/${fileName}`

          // Upload file to Supabase Storage
          const { error: uploadError } = await supabase.storage
            .from('job-files')
            .upload(filePath, file)

          if (uploadError) {
            console.error('Upload error:', uploadError)
            alert(`Failed to upload ${file.name}`)
            continue
          }

          // Get public URL
          const { data: { publicUrl } } = supabase.storage
            .from('job-files')
            .getPublicUrl(filePath)

          // Insert into communications table as a file record
          // Note: This is a simplified approach - you may need to adjust based on your actual file storage schema
          const { error: insertError } = await supabase
            .from('communications')
            .insert({
              tenant_id: tenantId,
              job_id: jobId,
              type: 'note',
              content: `Signed Contracts uploaded: ${file.name}`,
              attachments: JSON.stringify([{
                name: file.name,
                url: publicUrl,
                label: 'Signed Contracts'
              }]),
              created_by: (await supabase.auth.getUser()).data.user?.id,
            })

          if (insertError) {
            console.error('Insert error:', insertError)
          }
        }

        setFileUploadVisible(false)
        alert('Files uploaded successfully')
      } catch (error) {
        console.error('Upload error:', error)
        alert('Failed to upload files')
      }
    },
    [jobId, tenantId]
  )

  // ── Action button handler ─────────────────────────────────────────────────

  const handleAction = useCallback(
    (q: QuoteListItem, cfg: ActionConfig) => {
      switch (cfg.action) {
        case 'inactive':
          return

        case 'expand_quote':
          setExpandedId(q.id)
          setTimeout(() => {
            const el = document.getElementById(`quote-editor-${q.id}`)
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }, 150)
          break

        case 'navigate_work_orders':
          router.push(`${window.location.pathname}?tab=work-orders`)
          break

        case 'navigate_invoices':
          router.push(`${window.location.pathname}?tab=invoices`)
          break

        case 'send_quote_email':
        case 'send_contracts_email':
        case 'file_upload':
        case 'not_yet_built':
        default:
          setNotBuiltVisible(true)
          break
      }
    },
    [router]
  )

  // ── Status change handler ─────────────────────────────────────────────────

  const handleStatusChange = useCallback(
    async (quoteId: string, status: string, isLocked: boolean) => {
      try {
        const res = await fetch(`/api/quotes/${quoteId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            status,
            is_locked: isLocked,
          }),
        })
        if (res.ok) {
          load()
        }
      } catch (error) {
        console.error('Error updating quote status:', error)
      }
    },
    [tenantId, load]
  )

  // ── Job stage change handler ───────────────────────────────────────────────

  const handleJobStageChange = useCallback(
    async (jobId: string, stage: string) => {
      try {
        const res = await fetch(`/api/jobs/${jobId}/stage`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            stage,
          }),
        })
        if (res.ok) {
          setCurrentJobStage(stage)
          load()
        }
      } catch (error) {
        console.error('Error updating job stage:', error)
      }
    },
    [tenantId, load]
  )

  // ── Check if any quote has reached target job stage or later ─────────────────

  const hasQuoteReachedStageOrLater = useCallback(
    (targetStage: string): boolean => {
      // Define stage order (earlier to later)
      const stageOrder = [
        'order_received',
        'sent_awaiting_approval',
        'approved_awaiting_signoff',
        'awaiting_signed_document',
        'signed_build_schedule',
        'repairs_in_progress',
        'complete_and_invoiced',
        'declined_close_out',
      ]

      const targetIndex = stageOrder.indexOf(targetStage)
      if (targetIndex === -1) return false

      // Map quote statuses to job stages
      const quoteStatusToJobStage: Record<string, string> = {
        'draft':             'order_received',
        'ready':             'order_received',
        'sent':              'sent_awaiting_approval',
        'approved':          'approved_awaiting_signoff',
        'partially_approved':'approved_awaiting_signoff',
        'rejected':          'declined_close_out',
      }

      // Check if any quote has reached target stage or later
      for (const quote of quotes) {
        const quoteStage = quoteStatusToJobStage[quote.status] || 'order_received'
        const quoteStageIndex = stageOrder.indexOf(quoteStage)
        if (quoteStageIndex >= targetIndex) {
          return true
        }
      }

      return false
    },
    [quotes]
  )

  // ── Receive sign off file upload handler ─────────────────────────────────────

  const handleReceiveSignOffUpload = useCallback(
    async (files: File[]) => {
      try {
        const supabase = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        )

        // Allowed file types
        const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
        const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx']

        let successfulUploads = 0
        let failedUploads = 0

        for (const file of files) {
          // Validate file type
          const fileExt = '.' + file.name.split('.').pop()?.toLowerCase()
          if (!allowedExtensions.includes(fileExt) || !allowedTypes.includes(file.type)) {
            alert(`Invalid file type: ${file.name}. Only PDF, JPG, PNG, DOC, and DOCX files are allowed.`)
            failedUploads++
            continue
          }

          const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}${fileExt}`
          const filePath = `tenants/${tenantId}/jobs/${jobId}/docs/${fileName}`

          // Upload file to Supabase Storage
          const { error: uploadError } = await supabase.storage
            .from('job-files')
            .upload(filePath, file)

          if (uploadError) {
            console.error('Upload error:', uploadError)
            alert(`Failed to upload ${file.name}: ${uploadError.message}`)
            failedUploads++
            continue
          }

          // Get public URL
          const { data: { publicUrl } } = supabase.storage
            .from('job-files')
            .getPublicUrl(filePath)

          // Get file kind (uppercase extension without dot)
          const fileKind = fileExt.replace('.', '').toUpperCase()

          // Insert into job_files table
          const { error: insertError } = await supabase
            .from('job_files')
            .insert({
              tenant_id: tenantId,
              job_id: jobId,
              description: 'Insured signed docs',
              file_name: file.name,
              file_kind: fileKind,
              storage_path: filePath,
              mime_type: file.type,
              size_bytes: file.size,
              added_by: (await supabase.auth.getUser()).data.user?.id,
              is_system_generated: false,
            })

          if (insertError) {
            console.error('Insert error:', insertError)
            alert(`Failed to save file record for ${file.name}: ${insertError.message}`)
            failedUploads++
          } else {
            successfulUploads++
          }
        }

        // Only proceed if at least one file was successfully uploaded
        if (successfulUploads === 0) {
          alert('No files were successfully uploaded. Please try again.')
          return
        }

        setReceiveSignOffVisible(false)
        
        // Set sign off filed date to today
        setSignOffFiledDate(new Date())
        
        // Only change job stage if no quote has already reached signed_build_schedule or later
        if (!hasQuoteReachedStageOrLater('signed_build_schedule')) {
          await handleJobStageChange(jobId, 'signed_build_schedule')
          
          // Refresh job stage
          const { data: jobData } = await supabase
            .from('jobs')
            .select('current_stage')
            .eq('id', jobId)
            .single()
          setCurrentJobStage(jobData?.current_stage ?? null)
        }

        const message = failedUploads > 0
          ? `${successfulUploads} file(s) uploaded successfully. ${failedUploads} file(s) failed. Job stage updated.`
          : 'Files uploaded successfully and job stage updated'
        alert(message)
      } catch (error) {
        console.error('Upload error:', error)
        alert('Failed to upload files')
      }
    },
    [jobId, tenantId, handleJobStageChange, hasQuoteReachedStageOrLater]
  )

  // ── Handle revert to previous version ────────────────────────────────────────

  const handleRevert = useCallback(async (currentQuoteId: string, targetQuoteId: string) => {
    setReverting(targetQuoteId)
    try {
      const response = await fetch(`/api/quotes/${currentQuoteId}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          targetQuoteId,
        }),
      })
      if (response.ok) {
        // Reload quotes list to show updated state
        load()
        setReverting(null)
      } else {
        console.error('Failed to revert quote')
        setReverting(null)
      }
    } catch (error) {
      console.error('Error reverting quote:', error)
      setReverting(null)
    }
  }, [tenantId, load])

  // ── Handle preview quote version ───────────────────────────────────────────────

  const handlePreviewVersion = useCallback((quoteId: string) => {
    setPreviewQuoteId(quoteId)
    setShowPreviewModal(true)
    setShowVersions(null) // Close version dropdown
  }, [])

  // ── Fetch quote data for preview ────────────────────────────────────────────────

  useEffect(() => {
    if (!showPreviewModal || !previewQuoteId) return

    setLoadingPreview(true)
    fetch(`/api/quotes/${previewQuoteId}?tenantId=${encodeURIComponent(tenantId)}`)
      .then(r => r.json())
      .then((data: any) => {
        setPreviewData(data)
      })
      .catch(error => {
        console.error('Error fetching quote for preview:', error)
        setPreviewData(null)
      })
      .finally(() => setLoadingPreview(false))
  }, [showPreviewModal, previewQuoteId, tenantId])

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        style={{
          padding: '32px 0',
          textAlign: 'center',
          fontFamily: 'DM Sans, sans-serif',
          fontSize: 13,
          color: '#9e998f',
        }}
      >
        Loading…
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: 'DM Sans, sans-serif' }}>
      {/* "Not yet built" modal */}
      {notBuiltVisible && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.42)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9000,
          }}
          onClick={() => setNotBuiltVisible(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: '32px 36px',
              maxWidth: 380,
              textAlign: 'center',
              fontFamily: 'DM Sans, sans-serif',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 34, marginBottom: 12 }}>🚧</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#3a3530', marginBottom: 8 }}>
              Not yet built
            </div>
            <p style={{ fontSize: 13, color: '#9e998f', lineHeight: 1.5, marginBottom: 24 }}>
              This section is not yet built — please build before this can work.
            </p>
            <button
              onClick={() => setNotBuiltVisible(false)}
              style={{
                fontFamily: 'DM Sans, sans-serif',
                fontSize: 13,
                fontWeight: 500,
                color: '#ffffff',
                background: '#3a3530',
                border: 'none',
                borderRadius: 6,
                padding: '8px 22px',
                cursor: 'pointer',
              }}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* File upload modal for signed contracts */}
      {fileUploadVisible && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.42)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9000,
          }}
          onClick={() => setFileUploadVisible(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: '32px 36px',
              maxWidth: 480,
              width: '90%',
              fontFamily: 'DM Sans, sans-serif',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 16, fontWeight: 600, color: '#3a3530', marginBottom: 8 }}>
              Upload Signed Contracts
            </div>
            <p style={{ fontSize: 13, color: '#9e998f', lineHeight: 1.5, marginBottom: 24 }}>
              Drag and drop files here or click to browse your computer.
            </p>

            {/* Drop zone */}
            <div
              style={{
                border: '2px dashed #d8d0c8',
                borderRadius: 8,
                padding: '40px 20px',
                textAlign: 'center',
                marginBottom: 20,
                cursor: 'pointer',
                transition: 'border-color 0.2s, background 0.2s',
              }}
              onClick={() => {
                const input = document.createElement('input')
                input.type = 'file'
                input.multiple = true
                input.onchange = e => {
                  const files = (e.target as HTMLInputElement).files
                  if (files && files.length > 0) {
                    handleFileUpload(Array.from(files))
                  }
                }
                input.click()
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 12 }}>📁</div>
              <div style={{ fontSize: 13, color: '#3a3530', marginBottom: 4 }}>
                Drop files here or click to browse
              </div>
              <div style={{ fontSize: 11, color: '#9e998f' }}>
                PDF, DOC, DOCX, JPG, PNG
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setFileUploadVisible(false)}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#3a3530',
                  background: '#f5f2ee',
                  border: '1px solid #e0dbd4',
                  borderRadius: 6,
                  padding: '8px 20px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clone option dialog */}
      {showCloneDialog && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.42)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9000,
          }}
          onClick={() => setShowCloneDialog(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: '32px 36px',
              maxWidth: 420,
              width: '90%',
              fontFamily: 'DM Sans, sans-serif',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 16, fontWeight: 600, color: '#3a3530', marginBottom: 8 }}>
              Duplicate Quote
            </div>
            <p style={{ fontSize: 13, color: '#9e998f', lineHeight: 1.5, marginBottom: 24 }}>
              How would you like to duplicate this quote?
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button
                onClick={() => handleClone(showCloneDialog, 'version')}
                disabled={cloningQuoteId === showCloneDialog}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#ffffff',
                  background: '#2e7d32',
                  border: 'none',
                  borderRadius: 6,
                  padding: '10px 20px',
                  cursor: cloningQuoteId === showCloneDialog ? 'default' : 'pointer',
                  transition: 'background 0.15s',
                  opacity: cloningQuoteId === showCloneDialog ? 0.7 : 1,
                }}
                onMouseEnter={e => {
                  if (cloningQuoteId !== showCloneDialog)
                    e.currentTarget.style.background = '#1b5e20'
                }}
                onMouseLeave={e => e.currentTarget.style.background = '#2e7d32'}
              >
                {cloningQuoteId === showCloneDialog ? 'Creating...' : 'New Version'}
              </button>
              <div style={{ fontSize: 11, color: '#9e998f', marginTop: -8, marginBottom: 4 }}>
                Creates a new version (V2, V3, etc.) of this quote. The original quote will be marked as rejected.
              </div>

              <button
                onClick={() => handleClone(showCloneDialog, 'new_quote')}
                disabled={cloningQuoteId === showCloneDialog}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#3a3530',
                  background: '#f5f2ee',
                  border: '1px solid #e0dbd4',
                  borderRadius: 6,
                  padding: '10px 20px',
                  cursor: cloningQuoteId === showCloneDialog ? 'default' : 'pointer',
                  transition: 'background 0.15s',
                  opacity: cloningQuoteId === showCloneDialog ? 0.7 : 1,
                }}
                onMouseEnter={e => {
                  if (cloningQuoteId !== showCloneDialog)
                    e.currentTarget.style.background = '#e0dbd4'
                }}
                onMouseLeave={e => e.currentTarget.style.background = '#f5f2ee'}
              >
                {cloningQuoteId === showCloneDialog ? 'Creating...' : 'New Quote'}
              </button>
              <div style={{ fontSize: 11, color: '#9e998f', marginTop: -8, marginBottom: 4 }}>
                Creates an entirely new quote with a new quote number. The original quote remains unchanged.
              </div>
            </div>

            <div style={{ marginTop: 20, textAlign: 'right' }}>
              <button
                onClick={() => setShowCloneDialog(null)}
                disabled={cloningQuoteId === showCloneDialog}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  color: '#9e998f',
                  background: 'transparent',
                  border: 'none',
                  cursor: cloningQuoteId === showCloneDialog ? 'default' : 'pointer',
                  padding: '4px 12px',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receive sign off modal */}
      {receiveSignOffVisible && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.42)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9000,
          }}
          onClick={() => setReceiveSignOffVisible(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: '32px 36px',
              maxWidth: 480,
              width: '90%',
              fontFamily: 'DM Sans, sans-serif',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 16, fontWeight: 600, color: '#3a3530', marginBottom: 8 }}>
              Upload Insured Signed Documents
            </div>
            <p style={{ fontSize: 13, color: '#9e998f', lineHeight: 1.5, marginBottom: 24 }}>
              Drag and drop files here or click to browse your computer.
            </p>

            {/* Drop zone */}
            <div
              style={{
                border: '2px dashed #d8d0c8',
                borderRadius: 8,
                padding: '40px 20px',
                textAlign: 'center',
                marginBottom: 20,
                cursor: 'pointer',
                transition: 'border-color 0.2s, background 0.2s',
              }}
              onClick={() => {
                const input = document.createElement('input')
                input.type = 'file'
                input.multiple = true
                input.accept = '.pdf,.jpg,.jpeg,.png,.doc,.docx'
                input.onchange = e => {
                  const files = (e.target as HTMLInputElement).files
                  if (files && files.length > 0) {
                    handleReceiveSignOffUpload(Array.from(files))
                  }
                }
                input.click()
              }}
              onDragOver={e => {
                e.preventDefault()
                e.currentTarget.style.borderColor = '#1a73e8'
                e.currentTarget.style.background = '#f0f7ff'
              }}
              onDragLeave={e => {
                e.currentTarget.style.borderColor = '#d8d0c8'
                e.currentTarget.style.background = 'transparent'
              }}
              onDrop={e => {
                e.preventDefault()
                e.currentTarget.style.borderColor = '#d8d0c8'
                e.currentTarget.style.background = 'transparent'
                const files = Array.from(e.dataTransfer.files)
                if (files.length > 0) {
                  handleReceiveSignOffUpload(files)
                }
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 12 }}>📁</div>
              <div style={{ fontSize: 13, color: '#3a3530', marginBottom: 4 }}>
                Drop files here or click to browse
              </div>
              <div style={{ fontSize: 11, color: '#9e998f' }}>
                PDF, JPG, PNG, DOC, DOCX
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setReceiveSignOffVisible(false)}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#3a3530',
                  background: '#f5f2ee',
                  border: '1px solid #e0dbd4',
                  borderRadius: 6,
                  padding: '8px 20px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quote Preview Modal */}
      {showPreviewModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9000,
          }}
          onClick={() => setShowPreviewModal(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              maxWidth: 900,
              width: '90%',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              fontFamily: 'DM Sans, sans-serif',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div
              style={{
                padding: '20px 24px',
                borderBottom: '1px solid #e0dbd4',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#3a3530', marginBottom: 4 }}>
                  Quote Version Preview
                </div>
                {previewData && (
                  <div style={{ fontSize: 12, color: '#9e998f' }}>
                    {previewData.quote_ref ?? '—'} • V{previewData.version} • {previewData.status.replace(/_/g, ' ')}
                  </div>
                )}
              </div>
              <button
                onClick={() => setShowPreviewModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 20,
                  color: '#9e998f',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: 4,
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#3a3530')}
                onMouseLeave={e => (e.currentTarget.style.color = '#9e998f')}
              >
                ×
              </button>
            </div>

            {/* Modal content */}
            <div style={{ padding: '24px', overflow: 'auto', flex: 1 }}>
              {loadingPreview ? (
                <div
                  style={{
                    padding: '40px',
                    textAlign: 'center',
                    fontSize: 13,
                    color: '#9e998f',
                  }}
                >
                  Loading...
                </div>
              ) : !previewData ? (
                <div
                  style={{
                    padding: '40px',
                    textAlign: 'center',
                    fontSize: 13,
                    color: '#c5221f',
                  }}
                >
                  Failed to load quote data
                </div>
              ) : (
                <>
                  {/* Quote summary */}
                  <div
                    style={{
                      marginBottom: 20,
                      padding: '16px',
                      background: '#f5f2ee',
                      borderRadius: 8,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: '#9e998f' }}>Total</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#3a3530' }}>
                        {fmt(previewData.total_amount ?? 0)} inc GST
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: '#9e998f' }}>Items</span>
                      <span style={{ fontSize: 13, color: '#3a3530' }}>
                        {previewData.items?.length ?? 0}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: '#9e998f' }}>Markup</span>
                      <span style={{ fontSize: 13, color: '#3a3530' }}>
                        {((previewData.markup_pct ?? 0) * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>

                  {/* Scope items by room */}
                  {previewData.items && previewData.items.length > 0 ? (
                    <div>
                      {(() => {
                        const itemsByRoom: Record<string, any[]> = {}
                        previewData.items.forEach((item: any) => {
                          const room = item.room || 'Uncategorized'
                          if (!itemsByRoom[room]) itemsByRoom[room] = []
                          itemsByRoom[room].push(item)
                        })

                        return Object.entries(itemsByRoom).map(([room, items]) => (
                          <div key={room} style={{ marginBottom: 16 }}>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: '#3a3530',
                                marginBottom: 8,
                                paddingBottom: 4,
                                borderBottom: '1px solid #e0dbd4',
                              }}
                            >
                              {room}
                            </div>
                            <div style={{ fontSize: 12, color: '#3a3530' }}>
                              {items.map((item: any, idx: number) => (
                                <div
                                  key={item.id}
                                  style={{
                                    padding: '8px 0',
                                    borderBottom:
                                      idx < items.length - 1 ? '1px solid #e8e4e0' : 'none',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'flex-start',
                                  }}
                                >
                                  <div style={{ flex: 1, paddingRight: 16 }}>
                                    <div style={{ marginBottom: 4 }}>{item.item_description}</div>
                                    <div style={{ fontSize: 11, color: '#9e998f' }}>
                                      {item.trade} • {item.qty} {item.unit}
                                    </div>
                                  </div>
                                  <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontWeight: 500 }}>
                                      {fmt(item.line_total ?? 0)}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))
                      })()}
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: '40px',
                        textAlign: 'center',
                        fontSize: 13,
                        color: '#9e998f',
                      }}
                    >
                      No items in this quote version
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Modal footer */}
            <div
              style={{
                padding: '16px 24px',
                borderTop: '1px solid #e0dbd4',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <button
                onClick={() => setShowPreviewModal(false)}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#3a3530',
                  background: '#f5f2ee',
                  border: '1px solid #d8d0c8',
                  borderRadius: 6,
                  padding: '8px 20px',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#e8e0d5')}
                onMouseLeave={e => (e.currentTarget.style.background = '#f5f2ee')}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 0 12px' }}>
        <button
          onClick={handleCreate}
          disabled={creating}
          style={{
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 13,
            fontWeight: 500,
            color: '#ffffff',
            background: '#3a3530',
            border: 'none',
            borderRadius: 6,
            padding: '7px 16px',
            cursor: creating ? 'default' : 'pointer',
            opacity: creating ? 0.7 : 1,
          }}
        >
          {creating ? 'Creating…' : '+ Quote'}
        </button>
      </div>

      {/* Empty state */}
      {quotes.length === 0 && (
        <div
          style={{
            background: '#ffffff',
            borderRadius: 8,
            padding: '40px 20px',
            textAlign: 'center',
            border: '1px solid #e0dbd4',
          }}
        >
          <p style={{ fontSize: 13, color: '#9e998f', marginBottom: 12 }}>
            No quotes yet for this job
          </p>
          <button
            onClick={handleCreate}
            disabled={creating}
            style={{
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 12,
              color: '#9e998f',
              background: 'none',
              border: '1px dashed #d8d0c8',
              borderRadius: 6,
              padding: '6px 16px',
              cursor: 'pointer',
            }}
          >
            Create first quote
          </button>
        </div>
      )}

      {/* Send it dialog */}
      {sendDialogQuoteId && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.42)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9000,
          }}
          onClick={() => setSendDialogQuoteId(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: '32px 36px',
              maxWidth: 380,
              textAlign: 'center',
              fontFamily: 'DM Sans, sans-serif',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 34, marginBottom: 12 }}>📧</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#3a3530', marginBottom: 8 }}>
              Send Quote
            </div>
            <p style={{ fontSize: 13, color: '#9e998f', lineHeight: 1.5, marginBottom: 24 }}>
              This function is not yet built - please send manually. The quote will be marked as sent and locked.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                onClick={() => setSendDialogQuoteId(null)}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#3a3530',
                  background: '#f5f2ee',
                  border: '1px solid #d8d0c8',
                  borderRadius: 6,
                  padding: '8px 20px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (sendDialogQuoteId) {
                    await handleStatusChange(sendDialogQuoteId, 'sent', true)
                    // Only change job stage if no quote has already reached sent_awaiting_approval or later
                    if (!hasQuoteReachedStageOrLater('sent_awaiting_approval')) {
                      await handleJobStageChange(jobId, 'sent_awaiting_approval')
                    }
                    setSendDialogQuoteId(null)
                  }
                }}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#ffffff',
                  background: '#1a73e8',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 20px',
                  cursor: 'pointer',
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Decline dialog */}
      {declineDialogQuoteId && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.42)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9000,
          }}
          onClick={() => {
            setDeclineDialogQuoteId(null)
            setDeclineOption(null)
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: '32px 36px',
              maxWidth: 480,
              width: '90%',
              fontFamily: 'DM Sans, sans-serif',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 16, fontWeight: 600, color: '#3a3530', marginBottom: 8 }}>
              Reject Quote
            </div>
            <p style={{ fontSize: 13, color: '#9e998f', lineHeight: 1.5, marginBottom: 24 }}>
              Please select a reason for rejecting this quote:
            </p>

            {!declineOption ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <button
                  onClick={() => setDeclineOption('claim_denied')}
                  style={{
                    fontFamily: 'DM Sans, sans-serif',
                    fontSize: 13,
                    fontWeight: 500,
                    color: '#3a3530',
                    background: '#ffffff',
                    border: '1px solid #d8d0c8',
                    borderRadius: 6,
                    padding: '12px 16px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#c8b89a')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#d8d0c8')}
                >
                  Claim denied by insurer
                </button>
                <button
                  onClick={() => setDeclineOption('claim_cancelled')}
                  style={{
                    fontFamily: 'DM Sans, sans-serif',
                    fontSize: 13,
                    fontWeight: 500,
                    color: '#3a3530',
                    background: '#ffffff',
                    border: '1px solid #d8d0c8',
                    borderRadius: 6,
                    padding: '12px 16px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#c8b89a')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#d8d0c8')}
                >
                  Claim cancelled
                </button>
                <button
                  onClick={() => setDeclineOption('new_quote_required')}
                  style={{
                    fontFamily: 'DM Sans, sans-serif',
                    fontSize: 13,
                    fontWeight: 500,
                    color: '#3a3530',
                    background: '#ffffff',
                    border: '1px solid #d8d0c8',
                    borderRadius: 6,
                    padding: '12px 16px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#c8b89a')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#d8d0c8')}
                >
                  New quote required
                </button>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: 13, color: '#3a3530', marginBottom: 20 }}>
                  {declineOption === 'claim_denied' && 'This will reject the quote and mark the job as declined.'}
                  {declineOption === 'claim_cancelled' && 'This will reject the quote and mark the job as declined.'}
                  {declineOption === 'new_quote_required' && 'This will create a new quote by cloning the current one, and mark the current quote as Superseded.'}
                </p>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setDeclineOption(null)}
                    style={{
                      fontFamily: 'DM Sans, sans-serif',
                      fontSize: 13,
                      fontWeight: 500,
                      color: '#3a3530',
                      background: '#f5f2ee',
                      border: '1px solid #d8d0c8',
                      borderRadius: 6,
                      padding: '8px 20px',
                      cursor: 'pointer',
                    }}
                  >
                    Back
                  </button>
                  <button
                    onClick={async () => {
                      if (declineDialogQuoteId) {
                        // Store rejection reason in approval_notes
                        const rejectionReason = declineOption === 'claim_denied' ? 'Claim denied by insurer' :
                                                 declineOption === 'claim_cancelled' ? 'Claim cancelled' :
                                                 'New quote required'
                        
                        if (declineOption === 'new_quote_required') {
                          // Clone quote and mark current as superseded
                          try {
                            const res = await fetch(`/api/quotes/${declineDialogQuoteId}/clone`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ tenantId }),
                            })
                            if (res.ok) {
                              await fetch(`/api/quotes/${declineDialogQuoteId}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  tenantId,
                                  status: 'rejected',
                                  is_locked: true,
                                  approval_notes: rejectionReason,
                                }),
                              })
                              load()
                            }
                          } catch (error) {
                            console.error('Error cloning quote:', error)
                          }
                        } else {
                          // Reject quote and mark job as declined
                          await fetch(`/api/quotes/${declineDialogQuoteId}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              tenantId,
                              status: 'rejected',
                              is_locked: true,
                              approval_notes: rejectionReason,
                            }),
                          })
                          await handleJobStageChange(jobId, 'declined_close_out')
                        }
                        setDeclineDialogQuoteId(null)
                        setDeclineOption(null)
                      }
                    }}
                    style={{
                      fontFamily: 'DM Sans, sans-serif',
                      fontSize: 13,
                      fontWeight: 500,
                      color: '#ffffff',
                      background: '#c5221f',
                      border: 'none',
                      borderRadius: 6,
                      padding: '8px 20px',
                      cursor: 'pointer',
                    }}
                  >
                    Confirm
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Approval options dialog */}
      {approveDialogQuoteId && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.42)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9000,
          }}
          onClick={() => setApproveDialogQuoteId(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: '32px 36px',
              maxWidth: 400,
              width: '90%',
              fontFamily: 'DM Sans, sans-serif',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 16, fontWeight: 600, color: '#3a3530', marginBottom: 8 }}>
              Approve Quote
            </div>
            <p style={{ fontSize: 13, color: '#9e998f', lineHeight: 1.5, marginBottom: 24 }}>
              How would you like to approve this quote?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button
                onClick={async () => {
                  if (approveDialogQuoteId) {
                    await handleStatusChange(approveDialogQuoteId, 'approved', true)
                    if (!hasQuoteReachedStageOrLater('approved_awaiting_signoff')) {
                      await handleJobStageChange(jobId, 'approved_awaiting_signoff')
                    }
                    setApproveDialogQuoteId(null)
                  }
                }}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#ffffff',
                  background: '#2e7d32',
                  border: 'none',
                  borderRadius: 6,
                  padding: '12px 16px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#1b5e20')}
                onMouseLeave={e => (e.currentTarget.style.background = '#2e7d32')}
              >
                Approve in full
              </button>
              <button
                onClick={async () => {
                  if (approveDialogQuoteId) {
                    // Fetch line items for partial approval
                    try {
                      const res = await fetch(`/api/quotes/${approveDialogQuoteId}/items?tenantId=${tenantId}`)
                      if (res.ok) {
                        const items = await res.json()
                        setQuoteLineItems(items)
                        setSelectedLineItems(items.map((i: any) => i.id))
                        setPartialApproveDialogQuoteId(approveDialogQuoteId)
                        setApproveDialogQuoteId(null)
                      }
                    } catch (error) {
                      console.error('Error fetching line items:', error)
                    }
                  }
                }}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#3a3530',
                  background: '#ffffff',
                  border: '1px solid #d8d0c8',
                  borderRadius: 6,
                  padding: '12px 16px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#c8b89a')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#d8d0c8')}
              >
                Partially Approved
              </button>
            </div>
            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setApproveDialogQuoteId(null)}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#3a3530',
                  background: '#f5f2ee',
                  border: '1px solid #d8d0c8',
                  borderRadius: 6,
                  padding: '8px 20px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send for Signature dialog */}
      {sendForSignatureQuoteId && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.42)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9000,
          }}
          onClick={() => setSendForSignatureQuoteId(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: '32px 36px',
              maxWidth: 420,
              width: '90%',
              textAlign: 'center',
              fontFamily: 'DM Sans, sans-serif',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 34, marginBottom: 12 }}>✍️</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#3a3530', marginBottom: 8 }}>
              Send for Signature
            </div>
            <p style={{ fontSize: 13, color: '#9e998f', lineHeight: 1.5, marginBottom: 24 }}>
              This part of the system is not yet built - it will be a pre drafted email with pre filled docs for the homeowner to sign.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                onClick={() => setSendForSignatureQuoteId(null)}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#3a3530',
                  background: '#f5f2ee',
                  border: '1px solid #d8d0c8',
                  borderRadius: 6,
                  padding: '8px 20px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (sendForSignatureQuoteId) {
                    await handleJobStageChange(jobId, 'awaiting_signed_document')
                    setSendForSignatureQuoteId(null)
                  }
                }}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#ffffff',
                  background: '#1a73e8',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 20px',
                  cursor: 'pointer',
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Partial approval dialog with line item selection */}
      {partialApproveDialogQuoteId && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.42)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9000,
          }}
          onClick={() => setPartialApproveDialogQuoteId(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: '32px 36px',
              maxWidth: 600,
              width: '90%',
              maxHeight: '80vh',
              fontFamily: 'DM Sans, sans-serif',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 16, fontWeight: 600, color: '#3a3530', marginBottom: 8 }}>
              Partially Approved
            </div>
            <p style={{ fontSize: 13, color: '#9e998f', lineHeight: 1.5, marginBottom: 20 }}>
              Select which line items to approve:
            </p>

            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <button
                onClick={() => setSelectedLineItems(quoteLineItems.map((i: any) => i.id))}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#3a3530',
                  background: '#ffffff',
                  border: '1px solid #d8d0c8',
                  borderRadius: 4,
                  padding: '4px 12px',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#c8b89a')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#d8d0c8')}
              >
                Tick all
              </button>
              <button
                onClick={() => setSelectedLineItems([])}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#3a3530',
                  background: '#ffffff',
                  border: '1px solid #d8d0c8',
                  borderRadius: 4,
                  padding: '4px 12px',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#c8b89a')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#d8d0c8')}
              >
                Clear all
              </button>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                border: '1px solid #e0dbd4',
                borderRadius: 6,
                padding: '12px',
                marginBottom: 20,
                maxHeight: '300px',
              }}
            >
              {quoteLineItems.map((item: any) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '8px',
                    borderBottom: '1px solid #e8e4e0',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setSelectedLineItems(prev =>
                      prev.includes(item.id)
                        ? prev.filter(id => id !== item.id)
                        : [...prev, item.id]
                    )
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedLineItems.includes(item.id)}
                    onChange={() => {}}
                    onClick={e => e.stopPropagation()}
                    style={{ marginRight: 12, cursor: 'pointer' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#3a3530', marginBottom: 2 }}>
                      {item.item_description || 'Untitled item'}
                    </div>
                    <div style={{ fontSize: 12, color: '#9e998f' }}>
                      {item.room && `Room: ${item.room} • `}
                      Qty: {item.qty} • {fmt(item.line_total || 0)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setPartialApproveDialogQuoteId(null)}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#3a3530',
                  background: '#f5f2ee',
                  border: '1px solid #d8d0c8',
                  borderRadius: 6,
                  padding: '8px 20px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (partialApproveDialogQuoteId && selectedLineItems.length > 0) {
                    // Update scope_items approval_status
                    for (const itemId of selectedLineItems) {
                      await fetch(`/api/quotes/${partialApproveDialogQuoteId}/items/${itemId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          tenantId,
                          approval_status: 'approved',
                        }),
                      })
                    }
                    // Mark unselected items as declined
                    for (const item of quoteLineItems) {
                      if (!selectedLineItems.includes(item.id)) {
                        await fetch(`/api/quotes/${partialApproveDialogQuoteId}/items/${item.id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            tenantId,
                            approval_status: 'declined',
                          }),
                        })
                      }
                    }
                    await handleStatusChange(partialApproveDialogQuoteId, 'partially_approved', true)
                    if (!hasQuoteReachedStageOrLater('approved_awaiting_signoff')) {
                      await handleJobStageChange(jobId, 'approved_awaiting_signoff')
                    }
                    setPartialApproveDialogQuoteId(null)
                    setSelectedLineItems([])
                    setQuoteLineItems([])
                  }
                }}
                disabled={selectedLineItems.length === 0}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#ffffff',
                  background: selectedLineItems.length > 0 ? '#2e7d32' : '#9e998f',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 20px',
                  cursor: selectedLineItems.length > 0 ? 'pointer' : 'not-allowed',
                  opacity: selectedLineItems.length > 0 ? 1 : 0.6,
                }}
              >
                Confirm Partial Approval
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quote rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {quotes.map(q => {
          const normalized  = normalizeStatus(q.status)
          const s           = STATUS_STYLES[normalized] ?? STATUS_STYLES.draft
          const label       = STATUS_LABELS[normalized] ?? normalized.replace(/_/g, ' ')
          const actionCfg   = STATUS_ACTIONS[normalized] ?? STATUS_ACTIONS.draft
          const isExpanded  = expandedId === q.id
          const displayTotal = q.total_amount

          return (
            <div
              key={q.id}
              style={{
                background: '#ffffff',
                borderRadius: 8,
                border: '1px solid #e0dbd4',
                overflow: 'visible',
              }}
            >
              {/* ── Summary row (accordion trigger) ── */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '12px 16px',
                  gap: 10,
                  cursor: 'pointer',
                  background: normalized === 'ready' ? '#e8f5e9' : isExpanded ? '#fafaf8' : '#ffffff',
                  borderBottom: isExpanded ? '1px solid #e0dbd4' : 'none',
                  borderRadius: isExpanded ? '8px 8px 0 0' : 8,
                  overflow: 'visible',
                  position: 'relative',
                }}
                onClick={() => setExpandedId(isExpanded ? null : q.id)}
              >
                {/* Quote ref */}
                <span
                  style={{
                    fontFamily: 'DM Mono, monospace',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#c8b89a',
                    minWidth: 110,
                    userSelect: 'none',
                  }}
                >
                  {q.quote_ref ?? '—'}
                </span>

                {/* Amount */}
                <span style={{ fontSize: 13, color: '#3a3530', fontWeight: 500, whiteSpace: 'nowrap' }}>
                  {displayTotal != null ? `${fmt(displayTotal)} inc GST` : '—'}
                </span>

                {/* Item count */}
                <span style={{ fontSize: 12, color: '#9e998f', whiteSpace: 'nowrap' }}>
                  {q.item_count} {q.item_count === 1 ? 'item' : 'items'}
                </span>


                {/* Version badge with dropdown */}
                {q.version > 1 && (
                  <div
                    ref={el => {
                      if (el) versionDropdownRefs.current[q.id] = el
                    }}
                    style={{ position: 'relative' }}
                  >
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        setShowVersions(showVersions === q.id ? null : q.id)
                      }}
                      style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        background: '#e8f0fe',
                        color: '#1a73e8',
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                        fontFamily: 'DM Sans, sans-serif',
                        flexShrink: 0,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#d2e3fc')}
                      onMouseLeave={e => (e.currentTarget.style.background = '#e8f0fe')}
                    >
                      V{q.version} ▾
                    </button>

                    {showVersions === q.id && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 'calc(100% + 4px)',
                          left: 0,
                          zIndex: 200,
                          background: '#ffffff',
                          border: '1px solid #e0dbd4',
                          borderRadius: 6,
                          boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
                          minWidth: 280,
                          padding: '4px',
                        }}
                      >
                        {loadingVersions ? (
                          <div
                            style={{
                              padding: '12px',
                              fontSize: 12,
                              color: '#9e998f',
                              textAlign: 'center',
                              fontFamily: 'DM Sans, sans-serif',
                            }}
                          >
                            Loading...
                          </div>
                        ) : !versionsMap[q.id] || versionsMap[q.id].length === 0 ? (
                          <div
                            style={{
                              padding: '12px',
                              fontSize: 12,
                              color: '#9e998f',
                              textAlign: 'center',
                              fontFamily: 'DM Sans, sans-serif',
                            }}
                          >
                            No versions found
                          </div>
                        ) : (
                          versionsMap[q.id].map((v: any) => (
                            <div
                              key={v.id}
                              style={{
                                padding: '8px 10px',
                                borderBottom:
                                  v.id !== versionsMap[q.id][versionsMap[q.id].length - 1].id
                                    ? '1px solid #e8e4e0'
                                    : 'none',
                                fontFamily: 'DM Sans, sans-serif',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  marginBottom: 4,
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: '#3a3530',
                                  }}
                                >
                                  V{v.version}
                                </span>
                                {v.is_active_version && (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      fontWeight: 500,
                                      color: '#2e7d32',
                                      background: '#e8f5e9',
                                      padding: '1px 6px',
                                      borderRadius: 10,
                                    }}
                                  >
                                    Current
                                  </span>
                                )}
                              </div>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: '#9e998f',
                                  marginBottom: 4,
                                }}
                              >
                                {v.status.replace(/_/g, ' ')} • {v.item_count} items
                              </div>
                              <div
                                style={{
                                  fontSize: 10,
                                  color: '#b0a89e',
                                  marginBottom: 6,
                                }}
                              >
                                {new Date(v.created_at).toLocaleDateString('en-AU', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </div>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                  onClick={e => {
                                    e.stopPropagation()
                                    handlePreviewVersion(v.id)
                                  }}
                                  style={{
                                    fontFamily: 'DM Sans, sans-serif',
                                    fontSize: 11,
                                    fontWeight: 500,
                                    color: '#ffffff',
                                    background: '#1a73e8',
                                    border: 'none',
                                    borderRadius: 4,
                                    padding: '4px 10px',
                                    cursor: 'pointer',
                                    transition: 'background 0.15s',
                                  }}
                                  onMouseEnter={e => (e.currentTarget.style.background = '#1557b0')}
                                  onMouseLeave={e => (e.currentTarget.style.background = '#1a73e8')}
                                >
                                  View
                                </button>
                                {!v.is_active_version && (
                                  <button
                                    onClick={e => {
                                      e.stopPropagation()
                                      handleRevert(q.id, v.id)
                                    }}
                                    disabled={reverting === v.id}
                                    style={{
                                      fontFamily: 'DM Sans, sans-serif',
                                      fontSize: 11,
                                      fontWeight: 500,
                                      color: '#ffffff',
                                      background: '#2e7d32',
                                      border: 'none',
                                      borderRadius: 4,
                                      padding: '4px 10px',
                                      cursor: reverting === v.id ? 'not-allowed' : 'pointer',
                                      transition: 'background 0.15s',
                                      opacity: reverting === v.id ? 0.7 : 1,
                                    }}
                                    onMouseEnter={e => !reverting && (e.currentTarget.style.background = '#1b5e20')}
                                    onMouseLeave={e => (e.currentTarget.style.background = '#2e7d32')}
                                  >
                                    {reverting === v.id ? 'Reverting...' : 'Revert'}
                                  </button>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Rejection reason badge */}
                {q.status === 'rejected' && q.approval_notes && (
                  <span
                    style={{
                      padding: '1px 7px',
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 500,
                      background: '#fce8e6',
                      color: '#c5221f',
                      flexShrink: 0,
                    }}
                  >
                    {q.approval_notes}
                  </span>
                )}

                {/* Spacer */}
                <div style={{ flex: 1 }} />

                {/* Status-dependent buttons - New workflow */}
                {/* Draft: Mark as Ready */}
                {(!q.is_locked && q.status === 'draft') && (
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      handleStatusChange(q.id, 'ready', true)
                    }}
                    style={{
                      fontFamily: 'DM Sans, sans-serif',
                      fontSize: 12,
                      fontWeight: 500,
                      color: '#ffffff',
                      background: '#2e7d32',
                      border: 'none',
                      borderRadius: 6,
                      padding: '6px 16px',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                      flexShrink: 0,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#1b5e20')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#2e7d32')}
                  >
                    Mark as Ready
                  </button>
                )}

                {/* Ready: Send it */}
                {(q.is_locked && q.status === 'ready') && (
                  <>
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        setSendDialogQuoteId(q.id)
                      }}
                      style={{
                        fontFamily: 'DM Sans, sans-serif',
                        fontSize: 12,
                        fontWeight: 500,
                        color: '#ffffff',
                        background: '#1a73e8',
                        border: 'none',
                        borderRadius: 6,
                        padding: '6px 16px',
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                        flexShrink: 0,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#1557b0')}
                      onMouseLeave={e => (e.currentTarget.style.background = '#1a73e8')}
                    >
                      Send it
                    </button>
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        handleStatusChange(q.id, 'draft', false)
                      }}
                      style={{
                        fontFamily: 'DM Sans, sans-serif',
                        fontSize: 12,
                        fontWeight: 500,
                        color: '#3a3530',
                        background: '#f5f2ee',
                        border: '1px solid #d8d0c8',
                        borderRadius: 6,
                        padding: '6px 16px',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        flexShrink: 0,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#e8e0d5')}
                      onMouseLeave={e => (e.currentTarget.style.background = '#f5f2ee')}
                    >
                      Unlock and Edit
                    </button>
                  </>
                )}

                {/* Sent: Approve and Reject buttons */}
                {q.status === 'sent' && (
                  <>
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        setApproveDialogQuoteId(q.id)
                      }}
                      style={{
                        fontFamily: 'DM Sans, sans-serif',
                        fontSize: 12,
                        fontWeight: 500,
                        color: '#ffffff',
                        background: '#2e7d32',
                        border: 'none',
                        borderRadius: 6,
                        padding: '6px 16px',
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                        flexShrink: 0,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#1b5e20')}
                      onMouseLeave={e => (e.currentTarget.style.background = '#2e7d32')}
                    >
                      Approve
                    </button>
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        setDeclineDialogQuoteId(q.id)
                      }}
                      style={{
                        fontFamily: 'DM Sans, sans-serif',
                        fontSize: 12,
                        fontWeight: 500,
                        color: '#ffffff',
                        background: '#c5221f',
                        border: 'none',
                        borderRadius: 6,
                        padding: '6px 16px',
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                        flexShrink: 0,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#a81815')}
                      onMouseLeave={e => (e.currentTarget.style.background = '#c5221f')}
                    >
                      Reject
                    </button>
                  </>
                )}

                {/* Approved: Send for Signature button (primary quote only) */}
                {(q.status === 'approved' || q.status === 'partially_approved') && (() => {
                  const primaryQuote = quotes.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0]
                  const isPrimary = primaryQuote && primaryQuote.id === q.id
                  return isPrimary
                })() && (
                  <>
                    {currentJobStage === 'signed_build_schedule' && signOffFiledDate ? (
                      <button
                        onClick={e => {
                          e.stopPropagation()
                        }}
                        style={{
                          fontFamily: 'DM Sans, sans-serif',
                          fontSize: 12,
                          fontWeight: 500,
                          color: '#9e998f',
                          background: '#f5f2ee',
                          border: '1px solid #e0dbd4',
                          borderRadius: 6,
                          padding: '6px 16px',
                          cursor: 'pointer',
                          transition: 'background 0.15s',
                          flexShrink: 0,
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#e8e0d5')}
                        onMouseLeave={e => (e.currentTarget.style.background = '#f5f2ee')}
                      >
                        Sign off received and filed {signOffFiledDate.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </button>
                    ) : (
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          if (currentJobStage === 'awaiting_signed_document') {
                            setReceiveSignOffVisible(true)
                          } else {
                            setSendForSignatureQuoteId(q.id)
                          }
                        }}
                        style={{
                          fontFamily: 'DM Sans, sans-serif',
                          fontSize: 12,
                          fontWeight: 500,
                          color: '#ffffff',
                          background: currentJobStage === 'awaiting_signed_document' ? '#2e7d32' : '#1a73e8',
                          border: 'none',
                          borderRadius: 6,
                          padding: '6px 16px',
                          cursor: 'pointer',
                          transition: 'background 0.15s',
                          flexShrink: 0,
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = currentJobStage === 'awaiting_signed_document' ? '#1b5e20' : '#1557b0')}
                        onMouseLeave={e => (e.currentTarget.style.background = currentJobStage === 'awaiting_signed_document' ? '#2e7d32' : '#1a73e8')}
                      >
                        {currentJobStage === 'awaiting_signed_document' ? 'Receive sign off' : 'Send for Signature'}
                      </button>
                    )}
                  </>
                )}

                {/* Rejected/Superseded: Show label */}
                {q.status === 'rejected' && !q.is_locked && (
                  <span
                    style={{
                      fontFamily: 'DM Sans, sans-serif',
                      fontSize: 12,
                      fontWeight: 500,
                      color: '#9e998f',
                      fontStyle: 'italic',
                      flexShrink: 0,
                    }}
                  >
                    Rejected
                  </span>
                )}

                {/* Sent and Locked with date */}
                {(q.is_locked && q.status !== 'ready' && q.status !== 'draft') && (
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      // Show locked dialog
                      alert('This quote is locked and cannot be edited')
                    }}
                    style={{
                      fontFamily: 'DM Sans, sans-serif',
                      fontSize: 12,
                      fontWeight: 500,
                      color: '#9e998f',
                      background: '#f5f2ee',
                      border: '1px solid #e0dbd4',
                      borderRadius: 6,
                      padding: '6px 16px',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                      flexShrink: 0,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#e8e0d5')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#f5f2ee')}
                  >
                    Sent and Locked {new Date(q.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </button>
                )}

                {/* 3-dot menu */}
                <div
                  data-menu-dropdown="true"
                  style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
                >
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      setMenuDropdownId(menuDropdownId === q.id ? null : q.id)
                    }}
                    title="More options"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#9e998f',
                      fontSize: 16,
                      padding: '4px 6px',
                      borderRadius: 4,
                      lineHeight: 1,
                      flexShrink: 0,
                      fontFamily: 'DM Sans, sans-serif',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#3a3530')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#9e998f')}
                  >
                    •••
                  </button>

                  {/* 3-dot menu dropdown */}
                  {menuDropdownId === q.id && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 6px)',
                        right: 0,
                        zIndex: 500,
                        background: '#ffffff',
                        border: '1px solid #e0dbd4',
                        borderRadius: 8,
                        boxShadow: '0 4px 20px rgba(0,0,0,0.13)',
                        padding: '4px 0',
                        minWidth: 220,
                      }}
                    >
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          setMenuDropdownId(null)
                          window.open(`/print/quotes/${q.id}`, '_blank')
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          width: '100%',
                          textAlign: 'left',
                          padding: '7px 14px',
                          fontSize: 12,
                          color: '#3a3530',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: 400,
                          fontFamily: 'DM Sans, sans-serif',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#f5f2ee'}
                        onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
                      >
                        <span style={{ fontSize: 10, color: '#c8b89a' }}>👁</span>
                        <span>Preview Quote</span>
                      </button>
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          setMenuDropdownId(null)
                          setShowCloneDialog(q.id)
                        }}
                        disabled={cloningQuoteId === q.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          width: '100%',
                          textAlign: 'left',
                          padding: '7px 14px',
                          fontSize: 12,
                          color: cloningQuoteId === q.id ? '#9e998f' : '#3a3530',
                          background: 'transparent',
                          border: 'none',
                          cursor: cloningQuoteId === q.id ? 'default' : 'pointer',
                          fontWeight: 400,
                          fontFamily: 'DM Sans, sans-serif',
                          transition: 'background 0.1s',
                          opacity: cloningQuoteId === q.id ? 0.7 : 1,
                        }}
                        onMouseEnter={e => {
                          if (cloningQuoteId !== q.id)
                            (e.currentTarget as HTMLButtonElement).style.background = '#f5f2ee'
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                        }}
                      >
                        <span style={{ fontSize: 10, color: '#c8b89a' }}>
                          {cloningQuoteId === q.id ? '⏳' : '📋'}
                        </span>
                        <span>
                          {cloningQuoteId === q.id ? 'Duplicating...' : 'Duplicate Quote'}
                        </span>
                      </button>
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          setSowLoading(q.id)
                          setMenuDropdownId(null)
                          // Open print version in new tab (without sidebar)
                          window.open(`/print/quotes/${q.id}/sow`, '_blank')
                          // Clear loading state after a short delay
                          setTimeout(() => setSowLoading(null), 500)
                        }}
                        disabled={sowLoading === q.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          width: '100%',
                          textAlign: 'left',
                          padding: '7px 14px',
                          fontSize: 12,
                          color: sowLoading === q.id ? '#9e998f' : '#3a3530',
                          background: 'transparent',
                          border: 'none',
                          cursor: sowLoading === q.id ? 'default' : 'pointer',
                          fontWeight: 400,
                          fontFamily: 'DM Sans, sans-serif',
                          transition: 'background 0.1s',
                          opacity: sowLoading === q.id ? 0.7 : 1,
                        }}
                        onMouseEnter={e => {
                          if (sowLoading !== q.id)
                            (e.currentTarget as HTMLButtonElement).style.background = '#f5f2ee'
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                        }}
                      >
                        <span style={{ fontSize: 10, color: '#c8b89a' }}>
                          {sowLoading === q.id ? '⏳' : '📄'}
                        </span>
                        <span>
                          {sowLoading === q.id ? 'Opening...' : 'Scope of Works Authorisation'}
                        </span>
                      </button>
                      {/* Building Contract - only show for approved quotes */}
                      {(q.status === 'approved' || q.status === 'partially_approved') && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            setSowLoading(q.id)
                            setMenuDropdownId(null)
                            // Open print version in new tab (without sidebar)
                            window.open(`/print/quotes/${q.id}/building-contract`, '_blank')
                            // Clear loading state after a short delay
                            setTimeout(() => setSowLoading(null), 500)
                          }}
                          disabled={sowLoading === q.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            width: '100%',
                            textAlign: 'left',
                            padding: '7px 14px',
                            fontSize: 12,
                            color: sowLoading === q.id ? '#9e998f' : '#3a3530',
                            background: 'transparent',
                            border: 'none',
                            cursor: sowLoading === q.id ? 'default' : 'pointer',
                            fontWeight: 400,
                            fontFamily: 'DM Sans, sans-serif',
                            transition: 'background 0.1s',
                            opacity: sowLoading === q.id ? 0.7 : 1,
                          }}
                          onMouseEnter={e => {
                            if (sowLoading !== q.id)
                              (e.currentTarget as HTMLButtonElement).style.background = '#f5f2ee'
                          }}
                          onMouseLeave={e => {
                            (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                          }}
                        >
                          <span style={{ fontSize: 10, color: '#c8b89a' }}>
                            {sowLoading === q.id ? '⏳' : '📋'}
                          </span>
                          <span>
                            {sowLoading === q.id ? 'Opening...' : 'Building Contract'}
                          </span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Delete */}
                <button
                  onClick={e => {
                    e.stopPropagation()
                    handleDelete(q.id, q.quote_ref)
                  }}
                  title="Delete quote"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#c0bab3',
                    fontSize: 14,
                    padding: '2px 5px',
                    borderRadius: 3,
                    lineHeight: 1,
                    flexShrink: 0,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#c5221f')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#c0bab3')}
                >
                  ✕
                </button>

                {/* Expand chevron */}
                <span
                  style={{
                    color: '#9e998f',
                    fontSize: 11,
                    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.15s ease',
                    userSelect: 'none',
                    flexShrink: 0,
                  }}
                >
                  ▼
                </span>
              </div>

              {/* Inline editor expansion */}
              {isExpanded && (
                <div id={`quote-editor-${q.id}`}>
                  <QuoteEditorClient
                    key={`${q.id}-${q.status}-${q.is_locked}`}
                    inline
                    jobId={jobId}
                    quoteId={q.id}
                    tenantId={tenantId}
                    job={job}
                    onQuoteUpdated={load}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
