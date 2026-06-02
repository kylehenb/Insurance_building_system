'use client'

import React, { useCallback, useEffect, useState, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { JobContext } from './InvoicesTab'
import { InvoiceEditor } from './InvoiceEditor'

// ─── Types ───────────────────────────────────────────────────────────────────

interface InvoiceLineItem {
  id: string
  description: string
  quantity: number
  unit: string | null
  unit_price: number
  line_total: number
  sort_order: number | null
}

interface InvoiceListItem {
  id: string
  invoice_ref: string | null
  invoice_type: string
  direction: string
  status: string | null
  amount_ex_gst: number | null
  gst: number | null
  amount_inc_gst: number | null
  markup_pct: number | null
  issued_date: string | null
  paid_date: string | null
  created_at: string
  line_items: InvoiceLineItem[]
  item_count: number
}

// ─── Constants ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  draft: { bg: '#fff8e1', text: '#b45309' },
  sent: { bg: '#e8f0fe', text: '#1a73e8' },
  paid: { bg: '#e8f5e9', text: '#2e7d32' },
  voided: { bg: '#fce8e6', text: '#c5221f' },
}

const TYPE_LABELS: Record<string, string> = {
  assessment: 'Assessment',
  repair: 'Repair',
  make_safe: 'Make Safe',
  excess: 'Excess',
  balance: 'Balance',
  progress: 'Progress',
  standard: 'Standard',
}

function fmt(v: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface InvoicesListProps {
  jobId: string
  tenantId: string
  ctx: JobContext
  onInvoiceUpdated?: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InvoicesList({ jobId, tenantId, ctx, onInvoiceUpdated }: InvoicesListProps) {
  const { job, barReport, makeSafeReport, roofReport, leakDetectionReport, approvedQuote, invoicedReportTypes } = ctx
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null)

  const [invoices, setInvoices] = useState<InvoiceListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [menuDropdownId, setMenuDropdownId] = useState<string | null>(null)
  const [statusChangingId, setStatusChangingId] = useState<string | null>(null)
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null)
  const initialLoadDone = useRef(false)

  // ── Data loading ─────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    const isFirst = !initialLoadDone.current
    if (isFirst) setLoading(true)
    try {
      const res = await fetch(`/api/invoices?jobId=${jobId}&tenantId=${tenantId}`)
      if (res.ok) {
        const data: InvoiceListItem[] = await res.json()
        // Only show outbound invoices in this panel
        setInvoices(data.filter(i => i.direction === 'outbound'))
      }
    } finally {
      if (isFirst) setLoading(false)
      initialLoadDone.current = true
    }
  }, [jobId, tenantId])

  useEffect(() => { load() }, [load])

  // ── Close menu dropdown on outside click ──────────────────────────────────

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

  // ── Running totals ────────────────────────────────────────────────────────

  const activeInvoices = invoices.filter(i => i.status !== 'voided')
  const totalInvoiced = activeInvoices.reduce((s, i) => s + (i.amount_inc_gst ?? 0), 0)
  const approvedAmount = approvedQuote?.approved_amount ?? approvedQuote?.total_amount ?? 0
  const balance = approvedAmount - totalInvoiced

  // ── Check which invoice types already exist ────────────────────────────────

  const hasAssessment = invoicedReportTypes.includes('assessment')
  const hasMakeSafe = invoicedReportTypes.includes('make_safe')
  const hasRoof = invoicedReportTypes.includes('roof')
  const hasLeakDetection = invoicedReportTypes.includes('leak_detection')
  const hasExcess = invoicedReportTypes.includes('excess')

  // ── Create handlers ───────────────────────────────────────────────────────

  const createInvoice = useCallback(async (type: string, extra?: Record<string, unknown>) => {
    setCreating(true)
    setCreateModalOpen(false)
    try {
      const res = await fetch('/api/invoices/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, jobId, tenantId, ...extra }),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: string }
        alert(err.error ?? 'Failed to create invoice')
        return
      }
      const { invoice: newInvoice } = await res.json() as { invoice: { id: string } }
      await load()
      onInvoiceUpdated?.()
      // Auto-expand and edit make_safe invoices so builder's margin is immediately visible
      if (type === 'make_safe' && newInvoice?.id) {
        setExpandedInvoiceId(newInvoice.id)
        setEditingInvoiceId(newInvoice.id)
      }
    } catch {
      alert('Failed to create invoice. Please try again.')
    } finally {
      setCreating(false)
    }
  }, [jobId, tenantId, load, onInvoiceUpdated])

  // ── Status change handler ─────────────────────────────────────────────────

  const handleStatusChange = useCallback(async (invoiceId: string, newStatus: string) => {
    setStatusChangingId(invoiceId)
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
      await supabase
        .from('invoices')
        .update({ status: newStatus })
        .eq('id', invoiceId)
        .eq('tenant_id', tenantId)
      load()
    } finally {
      setStatusChangingId(null)
    }
  }, [tenantId, load])

  // ── Delete handler (hard delete for draft invoices) ───────────────────────

  const handleDelete = useCallback(async (invoiceId: string, invoiceRef: string | null) => {
    if (!window.confirm(`Delete invoice ${invoiceRef ?? 'this invoice'}? This cannot be undone.`)) return
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    await supabase.from('invoices').delete().eq('id', invoiceId).eq('tenant_id', tenantId)
    setInvoices(prev => prev.filter(i => i.id !== invoiceId))
    onInvoiceUpdated?.()
  }, [tenantId, onInvoiceUpdated])

  if (loading) {
    return (
      <div style={{ padding: '32px 0', textAlign: 'center', fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#9e998f' }}>
        Loading…
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'DM Sans, sans-serif' }}>
      {/* Create Invoice Modal */}
      {createModalOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000 }}
          onClick={() => setCreateModalOpen(false)}
        >
          <div
            style={{ background: '#fff', borderRadius: 12, padding: '28px 32px', maxWidth: 440, width: '90%', fontFamily: 'DM Sans, sans-serif', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 15, fontWeight: 600, color: '#3a3530', marginBottom: 20 }}>Create Invoice</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Assessment (BAR) */}
              <button
                disabled={!barReport || hasAssessment}
                onClick={() => createInvoice('assessment', { reportId: barReport?.id })}
                style={{
                  textAlign: 'left', padding: '12px 16px', border: '1px solid #e0dbd4',
                  borderRadius: 8, background: (!barReport || hasAssessment) ? '#f5f2ee' : '#fff',
                  cursor: (!barReport || hasAssessment) ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: (!barReport || hasAssessment) ? '#9e998f' : '#3a3530' }}>
                  Assessment (BAR)
                </div>
                <div style={{ fontSize: 11, color: '#9e998f', marginTop: 2 }}>
                  {!barReport ? 'No BAR report exists for this job' : hasAssessment ? 'Assessment invoice already exists' : 'Single charge from rate config'}
                </div>
              </button>

              {/* Make Safe */}
              <button
                disabled={!makeSafeReport || hasMakeSafe}
                onClick={() => createInvoice('make_safe', { reportId: makeSafeReport?.id })}
                style={{
                  textAlign: 'left', padding: '12px 16px', border: '1px solid #e0dbd4',
                  borderRadius: 8, background: (!makeSafeReport || hasMakeSafe) ? '#f5f2ee' : '#fff',
                  cursor: (!makeSafeReport || hasMakeSafe) ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: (!makeSafeReport || hasMakeSafe) ? '#9e998f' : '#3a3530' }}>
                  Make Safe
                </div>
                <div style={{ fontSize: 11, color: '#9e998f', marginTop: 2 }}>
                  {!makeSafeReport ? 'No make safe report exists for this job' : hasMakeSafe ? 'Make safe invoice already exists' : 'Single charge from rate config'}
                </div>
              </button>

              {/* Roof Report */}
              <button
                disabled={!roofReport || hasRoof}
                onClick={() => createInvoice('roof', { reportId: roofReport?.id })}
                style={{
                  textAlign: 'left', padding: '12px 16px', border: '1px solid #e0dbd4',
                  borderRadius: 8, background: (!roofReport || hasRoof) ? '#f5f2ee' : '#fff',
                  cursor: (!roofReport || hasRoof) ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: (!roofReport || hasRoof) ? '#9e998f' : '#3a3530' }}>
                  Roof Report
                </div>
                <div style={{ fontSize: 11, color: '#9e998f', marginTop: 2 }}>
                  {!roofReport ? 'No roof report exists for this job' : hasRoof ? 'Roof invoice already exists' : 'Single charge from rate config'}
                </div>
              </button>

              {/* Leak Detection Report */}
              <button
                disabled={!leakDetectionReport || hasLeakDetection}
                onClick={() => createInvoice('leak_detection', { reportId: leakDetectionReport?.id })}
                style={{
                  textAlign: 'left', padding: '12px 16px', border: '1px solid #e0dbd4',
                  borderRadius: 8, background: (!leakDetectionReport || hasLeakDetection) ? '#f5f2ee' : '#fff',
                  cursor: (!leakDetectionReport || hasLeakDetection) ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: (!leakDetectionReport || hasLeakDetection) ? '#9e998f' : '#3a3530' }}>
                  Leak Detection Report
                </div>
                <div style={{ fontSize: 11, color: '#9e998f', marginTop: 2 }}>
                  {!leakDetectionReport ? 'No leak detection report exists for this job' : hasLeakDetection ? 'Leak detection invoice already exists' : 'Single charge from rate config'}
                </div>
              </button>

              {/* Excess */}
              <button
                disabled={!job.excess || hasExcess}
                onClick={() => createInvoice('excess', { excessAmountIncGst: job.excess! })}
                style={{
                  textAlign: 'left', padding: '12px 16px', border: '1px solid #e0dbd4',
                  borderRadius: 8, background: (!job.excess || hasExcess) ? '#f5f2ee' : '#fff',
                  cursor: (!job.excess || hasExcess) ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: (!job.excess || hasExcess) ? '#9e998f' : '#3a3530' }}>
                  Excess
                </div>
                <div style={{ fontSize: 11, color: '#9e998f', marginTop: 2 }}>
                  {!job.excess ? 'No excess amount on this job' : hasExcess ? 'Excess invoice already exists' : `${fmt(job.excess)} (inc GST)`}
                </div>
              </button>

              {/* Balance */}
              <button
                onClick={() => createInvoice('balance')}
                style={{
                  textAlign: 'left', padding: '12px 16px', border: '1px solid #e0dbd4',
                  borderRadius: 8, background: '#fff',
                  cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: '#3a3530' }}>Balance / Final</div>
                <div style={{ fontSize: 11, color: '#9e998f', marginTop: 2 }}>
                  {approvedAmount > 0
                    ? `${fmt(Math.max(0, balance))} remaining of ${fmt(approvedAmount)}`
                    : 'No approved quote — balance will be $0.00'}
                </div>
              </button>
            </div>

            <button
              onClick={() => setCreateModalOpen(false)}
              style={{ marginTop: 20, fontFamily: 'DM Sans, sans-serif', fontSize: 12, color: '#9e998f', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#3a3530' }}>
          Invoices ({invoices.length})
        </div>
        <button
          onClick={() => setCreateModalOpen(true)}
          disabled={creating}
          style={{
            fontFamily: 'DM Sans, sans-serif', fontSize: 13, fontWeight: 500,
            color: '#ffffff', background: '#3a3530', border: 'none', borderRadius: 6,
            padding: '8px 16px', cursor: creating ? 'not-allowed' : 'pointer',
            opacity: creating ? 0.6 : 1,
          }}
        >
          {creating ? 'Creating…' : '+ Create Invoice'}
        </button>
      </div>

      {/* Empty state */}
      {invoices.length === 0 && (
        <div style={{ padding: '48px 24px', textAlign: 'center', background: '#f5f2ee', borderRadius: 8 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
          <div style={{ fontSize: 14, color: '#3a3530', marginBottom: 4 }}>No invoices yet</div>
          <div style={{ fontSize: 12, color: '#9e998f' }}>Create an invoice to track payments for this job</div>
        </div>
      )}

      {/* Invoice list */}
      {invoices.map((invoice) => {
        const statusStyle = STATUS_STYLES[invoice.status ?? 'draft'] ?? STATUS_STYLES.draft
        const statusLabel = (invoice.status ?? 'draft').charAt(0).toUpperCase() + (invoice.status ?? 'draft').slice(1)

        return (
          <div
            key={invoice.id}
            style={{
              background: '#ffffff', border: '1px solid #e0dbd4', borderRadius: 8,
              marginBottom: 10, overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
                cursor: 'pointer',
              }}
              onClick={() => {
                const isExpanding = expandedInvoiceId !== invoice.id
                setExpandedInvoiceId(isExpanding ? invoice.id : null)
                // Make safe draft invoices open directly in edit mode
                if (isExpanding && invoice.invoice_type === 'make_safe' && invoice.status === 'draft') {
                  setEditingInvoiceId(invoice.id)
                }
              }}
            >
              {/* Invoice ref */}
              <div style={{ fontSize: 13, fontWeight: 500, color: '#3a3530', flex: 1 }}>
                {invoice.invoice_ref ?? 'Draft Invoice'}
              </div>

              {/* Type badge */}
              <div style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: '#e8e0d0', color: '#3a3530' }}>
                {TYPE_LABELS[invoice.invoice_type] ?? invoice.invoice_type}
              </div>

              {/* Status badge */}
              <div style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: statusStyle.bg, color: statusStyle.text }}>
                {statusLabel}
              </div>

              {/* Amount */}
              <div style={{ fontSize: 14, fontWeight: 600, color: '#3a3530', minWidth: 90, textAlign: 'right' }}>
                {fmt(invoice.amount_inc_gst ?? 0)}
              </div>

              {/* Expand/collapse icon */}
              <div style={{ fontSize: 12, color: '#9e998f', transition: 'transform 0.2s', transform: expandedInvoiceId === invoice.id ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                ▼
              </div>

              {/* Quick send button for drafts */}
              {invoice.status === 'draft' && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleStatusChange(invoice.id, 'sent') }}
                  disabled={statusChangingId === invoice.id}
                  style={{
                    fontSize: 11, fontWeight: 500, color: '#fff', background: '#3a3530',
                    border: 'none', borderRadius: 4, padding: '5px 10px',
                    cursor: statusChangingId === invoice.id ? 'not-allowed' : 'pointer',
                    opacity: statusChangingId === invoice.id ? 0.6 : 1,
                  }}
                >
                  {statusChangingId === invoice.id ? '…' : 'Send'}
                </button>
              )}

              {/* 3-dot menu */}
              <div style={{ position: 'relative' }} data-menu-dropdown>
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuDropdownId(menuDropdownId === invoice.id ? null : invoice.id) }}
                  style={{ fontSize: 16, color: '#9e998f', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px' }}
                >
                  •••
                </button>

                {menuDropdownId === invoice.id && (
                  <div style={{
                    position: 'absolute', top: '100%', right: 0, marginTop: 4,
                    background: '#fff', border: '1px solid #e0dbd4', borderRadius: 6,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 100, minWidth: 150,
                  }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); window.open(`/print/invoices/${invoice.id}`, '_blank'); setMenuDropdownId(null) }}
                      style={{ width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 13, color: '#3a3530', background: 'none', border: 'none', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f5f2ee')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      PDF Preview
                    </button>
                    {invoice.status === 'draft' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(invoice.id, invoice.invoice_ref); setMenuDropdownId(null) }}
                        style={{ width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 13, color: '#c5221f', background: 'none', border: 'none', cursor: 'pointer', borderTop: '1px solid #e0dbd4' }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#fce8e6')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Accordion content - inline invoice editor */}
            {expandedInvoiceId === invoice.id && (
              <div style={{ borderTop: '1px solid #e0dbd4', padding: '16px' }}>
                <div onClick={(e) => e.stopPropagation()}>
                  {editingInvoiceId === invoice.id ? (
                    <InvoiceEditor
                      jobId={jobId}
                      invoiceId={invoice.id}
                      tenantId={tenantId}
                      job={{
                        job_number: job.job_number,
                        insurer: job.insurer,
                        insured_name: job.insured_name,
                        property_address: job.property_address,
                      }}
                      onInvoiceUpdated={() => {
                        load()
                        onInvoiceUpdated?.()
                      }}
                    />
                  ) : (
                    <div>
                      {/* Line items preview */}
                      {invoice.line_items.length > 0 ? (
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ fontSize: 12, color: '#9e998f', marginBottom: 8 }}>Line Items</div>
                          {invoice.line_items.map((item) => (
                            <div
                              key={item.id}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                padding: '8px 0',
                                fontSize: 13,
                                color: '#3a3530',
                                borderBottom: '1px solid #e8e0d0',
                              }}
                            >
                              <div style={{ flex: 1 }}>{item.description}</div>
                              <div style={{ minWidth: 60, textAlign: 'right' }}>{item.quantity}</div>
                              <div style={{ minWidth: 80, textAlign: 'right' }}>{fmt(item.unit_price)}</div>
                              <div style={{ minWidth: 90, textAlign: 'right', fontWeight: 500 }}>{fmt(item.line_total)}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, color: '#9e998f', marginBottom: 16 }}>No line items</div>
                      )}

                      {/* Totals */}
                      {invoice.invoice_type === 'make_safe' && (() => {
                        const lineSub = invoice.line_items.reduce((s, i) => s + i.line_total, 0)
                        const pct = invoice.markup_pct ?? 0
                        const markup = Math.round(lineSub * pct * 100) / 100
                        return (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: '#9e998f' }}>
                              <span>Subtotal</span>
                              <span style={{ color: '#3a3530', fontSize: 13 }}>{fmt(lineSub)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: '#9e998f' }}>
                              <span>Builder&apos;s Margin ({(pct * 100).toFixed(1)}%)</span>
                              <span style={{ color: '#3a3530', fontSize: 13 }}>{fmt(markup)}</span>
                            </div>
                          </>
                        )
                      })()}
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: '#9e998f' }}>
                        <span>Subtotal (ex GST)</span>
                        <span style={{ color: '#3a3530', fontSize: 13 }}>{fmt(invoice.amount_ex_gst ?? 0)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: '#9e998f' }}>
                        <span>GST (10%)</span>
                        <span style={{ color: '#3a3530', fontSize: 13 }}>{fmt(invoice.gst ?? 0)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid #e0dbd4' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#3a3530' }}>Total (inc GST)</span>
                        <span style={{ fontSize: 15, fontWeight: 600, color: '#3a3530' }}>{fmt(invoice.amount_inc_gst ?? 0)}</span>
                      </div>

                      {/* Edit button */}
                      {invoice.status === 'draft' && (
                        <button
                          onClick={() => setEditingInvoiceId(invoice.id)}
                          style={{
                            marginTop: 16,
                            fontFamily: 'DM Sans, sans-serif',
                            fontSize: 13,
                            color: '#3a3530',
                            background: '#ffffff',
                            border: '1px solid #e0dbd4',
                            borderRadius: 6,
                            padding: '8px 16px',
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = '#c8b89a'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = '#e0dbd4'
                          }}
                        >
                          Edit Invoice
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Running totals */}
      {invoices.length > 0 && (
        <div style={{
          marginTop: 20, background: '#fafaf8', border: '1px solid #e0dbd4', borderRadius: 8,
          padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16,
        }}>
          <div>
            <div style={{ fontSize: 11, color: '#9e998f', marginBottom: 4 }}>Approved Quote</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#3a3530' }}>
              {approvedAmount > 0 ? fmt(approvedAmount) : '—'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#9e998f', marginBottom: 4 }}>Total Invoiced</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#3a3530' }}>{fmt(totalInvoiced)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#9e998f', marginBottom: 4 }}>Balance Remaining</div>
            <div style={{
              fontSize: 15, fontWeight: 600,
              color: balance < 0 ? '#c5221f' : balance === 0 ? '#2e7d32' : '#3a3530',
            }}>
              {approvedAmount > 0 ? fmt(balance) : '—'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
