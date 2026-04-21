'use client'

import React, { useCallback, useEffect, useState, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'

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

// ─── Status constants ─────────────────────────────────────────────────────────

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

  // ── Close dropdown on outside click ──────────────────────────────────────

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
      {/* Header with create button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#3a3530' }}>
          Invoices ({invoices.length})
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
      {invoices.length === 0 && (
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
              onClick={() => setExpandedId(expandedId === invoice.id ? null : invoice.id)}
              style={{
                padding: '16px 20px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: expandedId === invoice.id ? '#f5f2ee' : '#ffffff',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1 }}>
                {/* Chevron */}
                <div style={{ fontSize: 12, color: '#9e998f', transition: 'transform 0.2s' }}>
                  {expandedId === invoice.id ? '▼' : '▶'}
                </div>

                {/* Invoice ref */}
                <div style={{ fontSize: 14, fontWeight: 500, color: '#3a3530' }}>
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
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {/* Amount */}
                <div style={{ fontSize: 14, fontWeight: 600, color: '#3a3530' }}>
                  {fmt(invoice.amount_inc_gst || 0)}
                </div>

                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(invoice.id, invoice.invoice_ref)
                  }}
                  style={{
                    fontSize: 12,
                    color: '#c5221f',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px 8px',
                  }}
                >
                  Delete
                </button>
              </div>
            </div>

            {/* Expanded content */}
            {expandedId === invoice.id && (
              <div style={{ padding: '20px', borderTop: '1px solid #e0dbd4' }}>
                {/* Invoice details */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, color: '#9e998f', marginBottom: 8 }}>
                    Invoice Details
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 11, color: '#9e998f', marginBottom: 2 }}>
                        Invoice Type
                      </div>
                      <div style={{ fontSize: 13, color: '#3a3530', textTransform: 'capitalize' }}>
                        {invoice.invoice_type}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#9e998f', marginBottom: 2 }}>
                        Direction
                      </div>
                      <div style={{ fontSize: 13, color: '#3a3530', textTransform: 'capitalize' }}>
                        {invoice.direction}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#9e998f', marginBottom: 2 }}>
                        Amount Ex GST
                      </div>
                      <div style={{ fontSize: 13, color: '#3a3530' }}>
                        {fmt(invoice.amount_ex_gst || 0)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#9e998f', marginBottom: 2 }}>
                        GST
                      </div>
                      <div style={{ fontSize: 13, color: '#3a3530' }}>
                        {fmt(invoice.gst || 0)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#9e998f', marginBottom: 2 }}>
                        Amount Inc GST
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#3a3530' }}>
                        {fmt(invoice.amount_inc_gst || 0)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#9e998f', marginBottom: 2 }}>
                        Issued Date
                      </div>
                      <div style={{ fontSize: 13, color: '#3a3530' }}>
                        {invoice.issued_date ? new Date(invoice.issued_date).toLocaleDateString('en-AU') : '—'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Line items */}
                <div>
                  <div style={{ fontSize: 12, color: '#9e998f', marginBottom: 8 }}>
                    Line Items ({invoice.item_count})
                  </div>
                  {invoice.line_items.length === 0 ? (
                    <div
                      style={{
                        padding: '16px',
                        background: '#f5f2ee',
                        borderRadius: 6,
                        textAlign: 'center',
                        fontSize: 13,
                        color: '#9e998f',
                      }}
                    >
                      No line items yet
                    </div>
                  ) : (
                    <div style={{ background: '#f5f2ee', borderRadius: 6, overflow: 'hidden' }}>
                      {/* Header */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '3fr 1fr 1fr 1fr',
                          gap: 12,
                          padding: '10px 16px',
                          fontSize: 11,
                          fontWeight: 600,
                          color: '#9e998f',
                          borderBottom: '1px solid #e0dbd4',
                        }}
                      >
                        <div>Description</div>
                        <div style={{ textAlign: 'right' }}>Qty</div>
                        <div style={{ textAlign: 'right' }}>Unit Price</div>
                        <div style={{ textAlign: 'right' }}>Total</div>
                      </div>
                      {/* Items */}
                      {invoice.line_items.map((item) => (
                        <div
                          key={item.id}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '3fr 1fr 1fr 1fr',
                            gap: 12,
                            padding: '10px 16px',
                            fontSize: 13,
                            color: '#3a3530',
                            borderBottom: '1px solid #e8e0d0',
                          }}
                        >
                          <div>{item.description}</div>
                          <div style={{ textAlign: 'right' }}>{item.quantity}</div>
                          <div style={{ textAlign: 'right' }}>{fmt(item.unit_price)}</div>
                          <div style={{ textAlign: 'right', fontWeight: 600 }}>
                            {fmt(item.line_total)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
