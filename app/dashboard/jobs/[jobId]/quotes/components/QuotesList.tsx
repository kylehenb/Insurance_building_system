'use client'

import React, { useCallback, useEffect, useState } from 'react'
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

// Ordered list — determines forward vs backward when changing status manually.
// Declined statuses sit at the end as terminal/side-branch states.
const STATUS_ORDER = [
  'draft',
  'ready',
  'sent_to_insurer',
  'approved_contracts_pending',
  'approved_contracts_sent',
  'approved_contracts_signed',
  'pre_repair',
  'repairs_in_progress',
  'repairs_complete_to_invoice',
  'complete_and_invoiced',
  'declined_superseded',
  'declined_claim_declined',
]

const STATUS_LABELS: Record<string, string> = {
  draft:                       'Draft',
  ready:                       'Ready',
  sent_to_insurer:             'Sent to insurer',
  approved_contracts_pending:  'Approved - Contracts pending',
  approved_contracts_sent:     'Approved - Contracts sent',
  approved_contracts_signed:   'Approved - Contracts signed',
  pre_repair:                  'Pre-Repair',
  repairs_in_progress:         'Repairs in progress',
  repairs_complete_to_invoice: 'Repairs complete - to invoice',
  complete_and_invoiced:       'Complete and Invoiced',
  declined_superseded:         'Declined - Superseded',
  declined_claim_declined:     'Declined - Claim Declined',
}

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  draft:                       { bg: '#fff8e1', text: '#b45309' },
  ready:                       { bg: '#e8f5e9', text: '#2e7d32' },
  sent_to_insurer:             { bg: '#e8f0fe', text: '#1a73e8' },
  approved_contracts_pending:  { bg: '#e8f5e9', text: '#2e7d32' },
  approved_contracts_sent:     { bg: '#e8f0fe', text: '#1a73e8' },
  approved_contracts_signed:   { bg: '#e8f5e9', text: '#2e7d32' },
  pre_repair:                  { bg: '#fff3e0', text: '#e65100' },
  repairs_in_progress:         { bg: '#fff3e0', text: '#e65100' },
  repairs_complete_to_invoice: { bg: '#e8f0fe', text: '#1a73e8' },
  complete_and_invoiced:       { bg: '#e8f5e9', text: '#2e7d32' },
  declined_superseded:         { bg: '#fce8e6', text: '#c5221f' },
  declined_claim_declined:     { bg: '#fce8e6', text: '#c5221f' },
}

const STATUS_ACTIONS: Record<string, ActionConfig> = {
  draft:                       { label: 'Complete quote',              action: 'expand_quote' },
  ready:                       { label: 'Send quote',                  action: 'send_quote_email' },
  sent_to_insurer:             { label: 'Waiting on insurer',          action: 'inactive',            inactive: true },
  approved_contracts_pending:  { label: 'Send contracts',              action: 'send_contracts_email' },
  approved_contracts_sent:     { label: 'Receive signed contracts',    action: 'file_upload' },
  approved_contracts_signed:   { label: 'Repairs in progress',         action: 'not_yet_built' },
  pre_repair:                  { label: 'Create schedule and work orders', action: 'navigate_work_orders' },
  repairs_in_progress:         { label: 'Complete repairs',            action: 'navigate_work_orders' },
  repairs_complete_to_invoice: { label: 'Invoice these repairs',       action: 'navigate_invoices' },
  complete_and_invoiced:       { label: 'Closed',                      action: 'inactive',            inactive: true },
  declined_superseded:         { label: 'Closed',                      action: 'inactive',            inactive: true },
  declined_claim_declined:     { label: 'Closed',                      action: 'inactive',            inactive: true },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Map old DB status values to new keys so legacy data still renders correctly. */
function normalizeStatus(status: string): string {
  const legacy: Record<string, string> = {
    sent:               'sent_to_insurer',
    approved:           'approved_contracts_pending',
    partially_approved: 'approved_contracts_pending',
    rejected:           'declined_claim_declined',
  }
  const lower = (status ?? 'draft').toLowerCase()
  return legacy[lower] ?? lower
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
  const [statusDropdownId, setStatusDropdownId] = useState<string | null>(null)
  const [hoveredStatus, setHoveredStatus] = useState<string | null>(null)
  const [notBuiltVisible, setNotBuiltVisible]   = useState(false)
  const [fileUploadVisible, setFileUploadVisible] = useState(false)
  const [sowLoading, setSowLoading]       = useState<string | null>(null)

  // ── Data loading ─────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/quotes?jobId=${jobId}&tenantId=${tenantId}`)
      if (res.ok) {
        const data: QuoteListItem[] = await res.json()
        setQuotes(data)
      }
    } finally {
      setLoading(false)
    }
  }, [jobId, tenantId])

  useEffect(() => { load() }, [load])

  // ── Close dropdown on outside click ──────────────────────────────────────

  useEffect(() => {
    if (!statusDropdownId) return
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-status-dropdown]')) {
        setStatusDropdownId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [statusDropdownId])

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

  // ── Status change (manual via dropdown) ──────────────────────────────────

  const handleStatusChange = useCallback(
    async (quoteId: string, newStatus: string, currentStatus: string) => {
      const currentIdx = getStatusIndex(currentStatus)
      const newIdx     = getStatusIndex(newStatus)
      const isBackward = newIdx !== -1 && currentIdx !== -1 && newIdx < currentIdx

      if (isBackward) {
        const confirmed = window.confirm(
          'Warning: Reverting to a prior status may cause issues with existing work orders, invoices, or contracts.\n\nAre you sure you want to proceed?'
        )
        if (!confirmed) {
          setStatusDropdownId(null)
          return
        }
      }

      const res = await fetch(`/api/quotes/${quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, status: newStatus }),
      })

      if (res.ok) {
        setQuotes(prev => prev.map(q => (q.id === quoteId ? { ...q, status: newStatus } : q)))
        if (onQuoteUpdated) onQuoteUpdated()
      }
      setStatusDropdownId(null)
    },
    [tenantId, onQuoteUpdated]
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
            .from('documents')
            .upload(filePath, file)

          if (uploadError) {
            console.error('Upload error:', uploadError)
            alert(`Failed to upload ${file.name}`)
            continue
          }

          // Get public URL
          const { data: { publicUrl } } = supabase.storage
            .from('documents')
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
          router.push(`${window.location.pathname}?tab=trade-work-orders`)
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

                {/* ── STATUS badge with dropdown chevron on LHS ── */}
                <div
                  data-status-dropdown="true"
                  style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
                >
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      setStatusDropdownId(statusDropdownId === q.id ? null : q.id)
                    }}
                    title="Change status"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '3px 9px',
                      borderRadius: 20,
                      fontSize: 11,
                      fontWeight: 500,
                      background: s.bg,
                      color: s.text,
                      border: 'none',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      fontFamily: 'DM Sans, sans-serif',
                    }}
                  >
                    {/* Dropdown chevron on LHS */}
                    <span
                      style={{
                        fontSize: 8,
                        opacity: 0.7,
                        marginRight: 1,
                      }}
                    >
                      ▾
                    </span>
                    {label}
                  </button>

                  {/* Status dropdown menu */}
                  {statusDropdownId === q.id && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 6px)',
                        left: 0,
                        zIndex: 500,
                        background: '#ffffff',
                        border: '1px solid #e0dbd4',
                        borderRadius: 8,
                        boxShadow: '0 4px 20px rgba(0,0,0,0.13)',
                        padding: '4px 0',
                        minWidth: 280,
                      }}
                    >
                      {/* Section 1: All statuses except declined */}
                      <div>
                        {STATUS_ORDER.filter(statusKey => !statusKey.startsWith('declined')).map(statusKey => {
                          const isCurrent  = normalized === statusKey
                          const keyIdx     = STATUS_ORDER.indexOf(statusKey)
                          const curIdx     = STATUS_ORDER.indexOf(normalized)
                          const isBackward = curIdx !== -1 && keyIdx !== -1 && keyIdx < curIdx
                          const isPrior    = curIdx !== -1 && keyIdx !== -1 && keyIdx < curIdx
                          const itemStyle  = STATUS_STYLES[statusKey] ?? STATUS_STYLES.draft
                          const actionCfg  = STATUS_ACTIONS[statusKey]

                          return (
                            <div key={statusKey} style={{ position: 'relative' }}>
                              <button
                                onClick={e => {
                                  e.stopPropagation()
                                  if (!isCurrent) handleStatusChange(q.id, statusKey, normalized)
                                }}
                                onMouseEnter={() => setHoveredStatus(statusKey)}
                                onMouseLeave={() => setHoveredStatus(null)}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  width: '100%',
                                  textAlign: 'left',
                                  padding: '7px 14px',
                                  fontSize: 12,
                                  color: isCurrent
                                    ? itemStyle.text
                                    : isBackward
                                    ? '#b0aaa3'
                                    : '#3a3530',
                                  background: isCurrent ? itemStyle.bg : 'transparent',
                                  border: 'none',
                                  cursor: isCurrent ? 'default' : 'pointer',
                                  fontWeight: isCurrent ? 600 : 400,
                                  fontFamily: 'DM Sans, sans-serif',
                                  transition: 'background 0.1s',
                                }}
                              >
                                <span style={{ fontSize: 9, width: 10, flexShrink: 0 }}>
                                  {isPrior || isCurrent ? '✓' : ''}
                                </span>
                                <span>{STATUS_LABELS[statusKey]}</span>
                                {isBackward && !isCurrent && (
                                  <span style={{ marginLeft: 'auto', fontSize: 10, color: '#c8b89a' }}>
                                    ←
                                  </span>
                                )}
                              </button>

                              {/* Sub-menu action on hover */}
                              {hoveredStatus === statusKey && actionCfg && !actionCfg.inactive && !isCurrent && (
                                <div
                                  style={{
                                    position: 'absolute',
                                    left: '100%',
                                    top: 0,
                                    marginLeft: 4,
                                    background: '#ffffff',
                                    border: '1px solid #e0dbd4',
                                    borderRadius: 6,
                                    boxShadow: '0 4px 20px rgba(0,0,0,0.13)',
                                    padding: '4px 0',
                                    minWidth: 180,
                                    zIndex: 501,
                                  }}
                                  onMouseEnter={() => setHoveredStatus(statusKey)}
                                  onMouseLeave={() => setHoveredStatus(null)}
                                >
                                  <button
                                    onClick={e => {
                                      e.stopPropagation()
                                      if (actionCfg.action === 'file_upload') {
                                        setFileUploadVisible(true)
                                        setStatusDropdownId(null)
                                      } else {
                                        handleAction(q, actionCfg)
                                      }
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
                                    onMouseEnter={e => {
                                      (e.currentTarget as HTMLButtonElement).style.background = '#f5f2ee'
                                    }}
                                    onMouseLeave={e => {
                                      (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                                    }}
                                  >
                                    <span style={{ fontSize: 10, color: '#c8b89a' }}>→</span>
                                    <span>{actionCfg.label}</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      {/* Beige horizontal line */}
                      <div style={{ height: 1, background: '#e0dbd4', margin: '4px 0' }} />

                      {/* Section 2: Declined statuses */}
                      <div>
                        {STATUS_ORDER.filter(statusKey => statusKey.startsWith('declined')).map(statusKey => {
                          const isCurrent  = normalized === statusKey
                          const keyIdx     = STATUS_ORDER.indexOf(statusKey)
                          const curIdx     = STATUS_ORDER.indexOf(normalized)
                          const isBackward = curIdx !== -1 && keyIdx !== -1 && keyIdx < curIdx
                          const isPrior    = curIdx !== -1 && keyIdx !== -1 && keyIdx < curIdx
                          const itemStyle  = STATUS_STYLES[statusKey] ?? STATUS_STYLES.draft
                          const actionCfg  = STATUS_ACTIONS[statusKey]

                          return (
                            <div key={statusKey} style={{ position: 'relative' }}>
                              <button
                                onClick={e => {
                                  e.stopPropagation()
                                  if (!isCurrent) handleStatusChange(q.id, statusKey, normalized)
                                }}
                                onMouseEnter={() => setHoveredStatus(statusKey)}
                                onMouseLeave={() => setHoveredStatus(null)}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  width: '100%',
                                  textAlign: 'left',
                                  padding: '7px 14px',
                                  fontSize: 12,
                                  color: isCurrent
                                    ? itemStyle.text
                                    : isBackward
                                    ? '#b0aaa3'
                                    : '#3a3530',
                                  background: isCurrent ? itemStyle.bg : 'transparent',
                                  border: 'none',
                                  cursor: isCurrent ? 'default' : 'pointer',
                                  fontWeight: isCurrent ? 600 : 400,
                                  fontFamily: 'DM Sans, sans-serif',
                                  transition: 'background 0.1s',
                                }}
                              >
                                <span style={{ fontSize: 9, width: 10, flexShrink: 0 }}>
                                  {isPrior || isCurrent ? '✓' : ''}
                                </span>
                                <span>{STATUS_LABELS[statusKey]}</span>
                                {isBackward && !isCurrent && (
                                  <span style={{ marginLeft: 'auto', fontSize: 10, color: '#c8b89a' }}>
                                    ←
                                  </span>
                                )}
                              </button>

                              {/* Sub-menu action on hover */}
                              {hoveredStatus === statusKey && actionCfg && !actionCfg.inactive && !isCurrent && (
                                <div
                                  style={{
                                    position: 'absolute',
                                    left: '100%',
                                    top: 0,
                                    marginLeft: 4,
                                    background: '#ffffff',
                                    border: '1px solid #e0dbd4',
                                    borderRadius: 6,
                                    boxShadow: '0 4px 20px rgba(0,0,0,0.13)',
                                    padding: '4px 0',
                                    minWidth: 180,
                                    zIndex: 501,
                                  }}
                                  onMouseEnter={() => setHoveredStatus(statusKey)}
                                  onMouseLeave={() => setHoveredStatus(null)}
                                >
                                  <button
                                    onClick={e => {
                                      e.stopPropagation()
                                      handleAction(q, actionCfg)
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
                                    onMouseEnter={e => {
                                      (e.currentTarget as HTMLButtonElement).style.background = '#f5f2ee'
                                    }}
                                    onMouseLeave={e => {
                                      (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                                    }}
                                  >
                                    <span style={{ fontSize: 10, color: '#c8b89a' }}>→</span>
                                    <span>{actionCfg.label}</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      {/* Beige horizontal line */}
                      <div style={{ height: 1, background: '#e0dbd4', margin: '4px 0' }} />

                      {/* Section 3: Manual create files */}
                      <div>
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            setSowLoading(q.id)
                            setStatusDropdownId(null)
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
                      </div>
                    </div>
                  )}
                </div>


                {/* Version badge */}
                {q.version > 1 && (
                  <span
                    style={{
                      padding: '1px 7px',
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 600,
                      background: '#e8f0fe',
                      color: '#1a73e8',
                      flexShrink: 0,
                    }}
                  >
                    V{q.version}
                  </span>
                )}

                {/* Spacer */}
                <div style={{ flex: 1 }} />

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
