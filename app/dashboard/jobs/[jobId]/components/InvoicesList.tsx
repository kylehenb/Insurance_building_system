'use client'

import React, { useCallback, useEffect, useState, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { InvoiceEditor } from './InvoiceEditor'

// ─── Types ───────────────────────────────────────────────────────────────────

interface JobInfo {
  job_number: string
  insurer: string | null
  insured_name: string | null
  property_address: string | null
  excess: number | null
}

interface InvoiceLineItem {
  id: string
  description: string
  quantity: number
  unit_price: number
  line_total: number
  sort_order: number
}

interface InvoiceListItem {
  id: string
  invoice_ref: string | null
  invoice_type: string
  direction: string
  status: string
  amount_ex_gst: number | null
  gst: number | null
  amount_inc_gst: number | null
  issued_date: string | null
  paid_date: string | null
  created_at: string
  line_items: InvoiceLineItem[]
  item_count: number
}

interface ActionConfig {
  label: string
  inactive?: boolean
  action: 'send_invoice' | 'record_payment' | 'void_invoice' | 'not_yet_built' | 'inactive'
}

// ─── Status constants ─────────────────────────────────────────────────────────

const STATUS_ORDER = ['draft', 'sent', 'paid', 'voided']

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  paid: 'Paid',
  voided: 'Voided',
}

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  draft: { bg: '#fff8e1', text: '#b45309' },
  sent: { bg: '#e8f0fe', text: '#1a73e8' },
  paid: { bg: '#e8f5e9', text: '#2e7d32' },
  voided: { bg: '#fce8e6', text: '#c5221f' },
}

const STATUS_ACTIONS: Record<string, ActionConfig> = {
  draft: { label: 'Send to client/insurer', action: 'send_invoice' },
  sent: { label: 'Record payment received', action: 'record_payment' },
  paid: { label: 'Invoice paid', action: 'inactive', inactive: true },
  voided: { label: 'Invoice voided', action: 'inactive', inactive: true },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface InvoicesListProps {
  jobId: string
  tenantId: string
  job: JobInfo
  onInvoiceUpdated?: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InvoicesList({ jobId, tenantId, job, onInvoiceUpdated }: InvoicesListProps) {
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createDropdownOpen, setCreateDropdownOpen] = useState(false)
  const createDropdownRef = useRef<HTMLDivElement>(null)
  const [menuDropdownId, setMenuDropdownId] = useState<string | null>(null)
  const [notBuiltVisible, setNotBuiltVisible] = useState(false)
  const [notBuiltAction, setNotBuiltAction] = useState<string | null>(null)
  const [statusChangingId, setStatusChangingId] = useState<string | null>(null)
  const initialLoadDone = useRef(false)

  // ── Data loading ─────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    const isFirst = !initialLoadDone.current
    if (isFirst) setLoading(true)
    try {
      const res = await fetch(`/api/invoices?jobId=${jobId}&tenantId=${tenantId}`)
      if (res.ok) {
        const data: InvoiceListItem[] = await res.json()
        setInvoices(data)
      }
    } finally {
      if (isFirst) setLoading(false)
      initialLoadDone.current = true
    }
  }, [jobId, tenantId])

  useEffect(() => { load() }, [load])

  // ── Close dropdowns on outside click ──────────────────────────────────────

  useEffect(() => {
    if (!createDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (createDropdownRef.current && !createDropdownRef.current.contains(e.target as Node)) {
        setCreateDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [createDropdownOpen])

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

  // ── Create invoice handlers ───────────────────────────────────────────────

  const handleCreateExcessInvoice = useCallback(async () => {
    if (!job.excess) {
      alert('This job has no excess amount configured.')
      return
    }

    setCreating(true)
    setCreateDropdownOpen(false)
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          tenantId,
          invoiceType: 'excess',
          direction: 'outbound',
          lineItems: [
            {
              description: 'Payment of applicable excess as requested by your insurer.',
              quantity: 1,
              unit_price: job.excess,
            },
          ],
        }),
      })
      if (!res.ok) throw new Error('Failed')
      const invoice: InvoiceListItem = await res.json()
      setInvoices(prev => [...prev, invoice])
      setExpandedId(invoice.id)
      onInvoiceUpdated?.()
    } catch {
      alert('Failed to create invoice. Please try again.')
    } finally {
      setCreating(false)
    }
  }, [jobId, tenantId, job.excess, onInvoiceUpdated])

  const handleCreateProgressInvoice = useCallback(async () => {
    setCreating(true)
    setCreateDropdownOpen(false)
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          tenantId,
          invoiceType: 'progress',
          direction: 'outbound',
          lineItems: [],
        }),
      })
      if (!res.ok) throw new Error('Failed')
      const invoice: InvoiceListItem = await res.json()
      setInvoices(prev => [...prev, invoice])
      setExpandedId(invoice.id)
      onInvoiceUpdated?.()
    } catch {
      alert('Failed to create invoice. Please try again.')
    } finally {
      setCreating(false)
    }
  }, [jobId, tenantId, onInvoiceUpdated])

  const handleCreateBalanceInvoice = useCallback(async () => {
    setCreating(true)
    setCreateDropdownOpen(false)
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          tenantId,
          invoiceType: 'balance',
          direction: 'outbound',
          lineItems: [],
        }),
      })
      if (!res.ok) throw new Error('Failed')
      const invoice: InvoiceListItem = await res.json()
      setInvoices(prev => [...prev, invoice])
      setExpandedId(invoice.id)
      onInvoiceUpdated?.()
    } catch {
      alert('Failed to create invoice. Please try again.')
    } finally {
      setCreating(false)
    }
  }, [jobId, tenantId, onInvoiceUpdated])

  // ── Delete handler ───────────────────────────────────────────────────────

  const handleDelete = useCallback(
    async (invoiceId: string, invoiceRef: string | null) => {
      if (!window.confirm(`Delete invoice ${invoiceRef ?? 'this invoice'}? This cannot be undone.`)) return
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
      const { error } = await supabase
        .from('invoices')
        .delete()
        .eq('id', invoiceId)
        .eq('tenant_id', tenantId)
      if (error) {
        alert('Failed to delete invoice')
        return
      }
      setInvoices(prev => prev.filter(i => i.id !== invoiceId))
      if (expandedId === invoiceId) setExpandedId(null)
      onInvoiceUpdated?.()
    },
    [tenantId, expandedId, onInvoiceUpdated]
  )

  // ── Status change handler ─────────────────────────────────────────────────

  const handleStatusChange = useCallback(
    async (invoiceId: string, newStatus: string) => {
      setStatusChangingId(invoiceId)
      try {
        const supabase = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        )
        const { error } = await supabase
          .from('invoices')
          .update({ status: newStatus })
          .eq('id', invoiceId)
          .eq('tenant_id', tenantId)
        if (error) {
          alert('Failed to update invoice status')
          return
        }
        load()
      } finally {
        setStatusChangingId(null)
      }
    },
    [tenantId, load]
  )

  // ── Action button handler ─────────────────────────────────────────────────

  const handleAction = useCallback(
    (invoice: InvoiceListItem, cfg: ActionConfig) => {
      switch (cfg.action) {
        case 'inactive':
          return
        case 'send_invoice':
          setNotBuiltAction('send_invoice')
          setNotBuiltVisible(true)
          break
        case 'record_payment':
          setNotBuiltAction('record_payment')
          setNotBuiltVisible(true)
          break
        case 'void_invoice':
          setNotBuiltAction('void_invoice')
          setNotBuiltVisible(true)
          break
        default:
          setNotBuiltVisible(true)
      }
    },
    []
  )

  // ── Confirm not-yet-built action ─────────────────────────────────────────

  const handleConfirmNotBuilt = useCallback(() => {
    if (!notBuiltAction) return

    // Determine next status based on action
    let nextStatus = 'draft'
    if (notBuiltAction === 'send_invoice') {
      nextStatus = 'sent'
    } else if (notBuiltAction === 'record_payment') {
      nextStatus = 'paid'
    } else if (notBuiltAction === 'void_invoice') {
      nextStatus = 'voided'
    }

    // Find the invoice that triggered this action
    const invoice = invoices.find(i => i.id === statusChangingId)
    if (invoice) {
      handleStatusChange(invoice.id, nextStatus)
    }

    setNotBuiltVisible(false)
    setNotBuiltAction(null)
  }, [notBuiltAction, statusChangingId, invoices, handleStatusChange])

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
              maxWidth: 480,
              width: '90%',
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
              {notBuiltAction === 'pdf_preview' && 'PDF Preview will generate a downloadable PDF of this invoice.'}
              {notBuiltAction === 'send_invoice' && 'Sending invoice will email the invoice to the client/insurer.'}
              {notBuiltAction === 'record_payment' && 'Recording payment will mark the invoice as paid and update payment date.'}
              {notBuiltAction === 'void_invoice' && 'Voiding will cancel this invoice and remove it from outstanding balances.'}
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                onClick={() => setNotBuiltVisible(false)}
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
              <button
                onClick={handleConfirmNotBuilt}
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#ffffff',
                  background: '#3a3530',
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

      {/* Header with create button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#3a3530' }}>
          Invoices ({invoices?.length ?? 0})
        </div>
        <div style={{ position: 'relative' }} ref={createDropdownRef}>
          <button
            onClick={() => setCreateDropdownOpen(!createDropdownOpen)}
            disabled={creating}
            style={{
              fontFamily: 'DM Sans, sans-serif',
              fontSize: 13,
              fontWeight: 500,
              color: '#ffffff',
              background: '#3a3530',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              cursor: creating ? 'not-allowed' : 'pointer',
              opacity: creating ? 0.6 : 1,
            }}
          >
            {creating ? 'Creating...' : '+ Create Invoice'}
          </button>

          {/* Dropdown menu */}
          {createDropdownOpen && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 8,
                background: '#ffffff',
                border: '1px solid #e0dbd4',
                borderRadius: 8,
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                zIndex: 100,
                minWidth: 200,
              }}
            >
              <button
                onClick={handleCreateExcessInvoice}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 16px',
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  color: '#3a3530',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  borderBottom: '1px solid #f5f2ee',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f5f2ee')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Excess Invoice
              </button>
              <button
                onClick={handleCreateProgressInvoice}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 16px',
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  color: '#3a3530',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  borderBottom: '1px solid #f5f2ee',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f5f2ee')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Progress Payment
              </button>
              <button
                onClick={handleCreateBalanceInvoice}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 16px',
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: 13,
                  color: '#3a3530',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f5f2ee')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Balance / Final Payment
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Empty state */}
      {(!invoices || invoices.length === 0) && (
        <div
          style={{
            padding: '48px 24px',
            textAlign: 'center',
            background: '#f5f2ee',
            borderRadius: 8,
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
          <div style={{ fontSize: 14, color: '#3a3530', marginBottom: 4 }}>
            No invoices yet
          </div>
          <div style={{ fontSize: 12, color: '#9e998f' }}>
            Create an invoice to track payments for this job
          </div>
        </div>
      )}

      {/* Invoice list */}
      {invoices.map((invoice) => {
        const statusStyle = STATUS_STYLES[invoice.status] || STATUS_STYLES.draft
        const statusLabel = STATUS_LABELS[invoice.status] || invoice.status
        const actionCfg = STATUS_ACTIONS[invoice.status] || STATUS_ACTIONS.draft

        return (
          <div
            key={invoice.id}
            style={{
              background: '#ffffff',
              border: '1px solid #e0dbd4',
              borderRadius: 8,
              marginBottom: 12,
              overflow: 'hidden',
            }}
          >
            {/* Summary header */}
            <div
              style={{
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: expandedId === invoice.id ? '#f5f2ee' : '#ffffff',
              }}
            >
              {/* Chevron */}
              <div
                onClick={() => setExpandedId(expandedId === invoice.id ? null : invoice.id)}
                style={{
                  fontSize: 12,
                  color: '#9e998f',
                  cursor: 'pointer',
                  padding: '4px',
                }}
              >
                {expandedId === invoice.id ? '▼' : '▶'}
              </div>

              {/* Invoice ref */}
              <div
                onClick={() => setExpandedId(expandedId === invoice.id ? null : invoice.id)}
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: '#3a3530',
                  cursor: 'pointer',
                  flex: 1,
                }}
              >
                {invoice.invoice_ref || 'Draft Invoice'}
              </div>

              {/* Type badge */}
              <div
                style={{
                  fontSize: 11,
                  padding: '4px 8px',
                  borderRadius: 4,
                  background: '#e8e0d0',
                  color: '#3a3530',
                  textTransform: 'capitalize',
                }}
              >
                {invoice.invoice_type}
              </div>

              {/* Status badge */}
              <div
                style={{
                  fontSize: 11,
                  padding: '4px 8px',
                  borderRadius: 4,
                  background: statusStyle.bg,
                  color: statusStyle.text,
                }}
              >
                {statusLabel}
              </div>

              {/* Amount */}
              <div style={{ fontSize: 14, fontWeight: 600, color: '#3a3530' }}>
                {fmt(invoice.amount_inc_gst || 0)}
              </div>

              {/* Action button */}
              {!actionCfg.inactive && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setStatusChangingId(invoice.id)
                    handleAction(invoice, actionCfg)
                  }}
                  disabled={statusChangingId === invoice.id}
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: '#ffffff',
                    background: '#3a3530',
                    border: 'none',
                    borderRadius: 4,
                    padding: '6px 12px',
                    cursor: statusChangingId === invoice.id ? 'not-allowed' : 'pointer',
                    opacity: statusChangingId === invoice.id ? 0.6 : 1,
                  }}
                >
                  {statusChangingId === invoice.id ? '...' : actionCfg.label}
                </button>
              )}

              {/* 3 dots menu */}
              <div style={{ position: 'relative' }} data-menu-dropdown>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuDropdownId(menuDropdownId === invoice.id ? null : invoice.id)
                  }}
                  style={{
                    fontSize: 16,
                    color: '#9e998f',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px 8px',
                  }}
                >
                  •••
                </button>

                {menuDropdownId === invoice.id && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      right: 0,
                      marginTop: 4,
                      background: '#ffffff',
                      border: '1px solid #e0dbd4',
                      borderRadius: 6,
                      boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                      zIndex: 100,
                      minWidth: 150,
                    }}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setExpandedId(invoice.id)
                        setMenuDropdownId(null)
                      }}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 12px',
                        fontSize: 13,
                        color: '#3a3530',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f5f2ee')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      Standard Invoice
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        window.open(`/print/invoices/${invoice.id}`, '_blank')
                        setMenuDropdownId(null)
                      }}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 12px',
                        fontSize: 13,
                        color: '#3a3530',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f5f2ee')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      PDF Preview
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(invoice.id, invoice.invoice_ref)
                        setMenuDropdownId(null)
                      }}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 12px',
                        fontSize: 13,
                        color: '#c5221f',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        borderTop: '1px solid #e0dbd4',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#fce8e6')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Expanded content */}
            {expandedId === invoice.id && (
              <div style={{ padding: '20px', borderTop: '1px solid #e0dbd4', background: '#f5f2ee' }}>
                <InvoiceEditor
                  jobId={jobId}
                  invoiceId={invoice.id}
                  tenantId={tenantId}
                  job={job}
                  onInvoiceUpdated={load}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
