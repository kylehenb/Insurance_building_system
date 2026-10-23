'use client'

import React, { useCallback, useEffect, useState, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import type { JobContext } from './InvoicesTab'
import { InvoiceEditor } from './InvoiceEditor'
import { SendDocumentModal } from '@/components/documents/SendDocumentModal'
import { pendingApprovalFrom } from '@/lib/approvals/client'

// ─── Types ───────────────────────────────────────────────────────────────────

interface InvoiceLineItem {
  id: string
  description: string
  quantity: number
  unit: string | null
  unit_price: number
  line_total: number
  sort_order: number | null
  quote_ref?: string | null
}

interface InvoiceDeduction {
  id: string
  description: string
  amount_inc_gst: number
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
  notes: string | null
  issued_date: string | null
  paid_date: string | null
  created_at: string
  line_items: InvoiceLineItem[]
  item_count: number
  deductions: InvoiceDeduction[]
}

const OTHER_ITEMS_LABEL = 'Additional Items'

function groupLineItemsByQuote(items: InvoiceLineItem[]) {
  const groups: { label: string; items: InvoiceLineItem[] }[] = []
  const indexByKey = new Map<string, number>()

  for (const item of items) {
    const key = item.quote_ref || '__other__'
    let idx = indexByKey.get(key)
    if (idx === undefined) {
      idx = groups.length
      indexByKey.set(key, idx)
      groups.push({ label: item.quote_ref ? `Quote ${item.quote_ref}` : OTHER_ITEMS_LABEL, items: [] })
    }
    groups[idx].items.push(item)
  }

  const otherIdx = groups.findIndex(g => g.label === OTHER_ITEMS_LABEL)
  if (groups.length > 1 && otherIdx !== -1 && otherIdx !== groups.length - 1) {
    groups.push(groups.splice(otherIdx, 1)[0])
  }

  return groups
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
  custom: 'Custom',
  quoted_amounts: 'Quoted Amounts',
  variations: 'Variations',
}

function fmt(v: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
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
  const { job, barReport, makeSafeReport, roofReport, leakDetectionReport, approvedQuote, approvedQuotes, hasAdditionalItems, invoicedReportTypes } = ctx
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null)

  const [invoices, setInvoices] = useState<InvoiceListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [menuDropdownId, setMenuDropdownId] = useState<string | null>(null)
  const [sendInvoiceId, setSendInvoiceId] = useState<string | null>(null)
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
  const hasQuotedAmounts = invoicedReportTypes.includes('quoted_amounts')
  const hasVariations = invoicedReportTypes.includes('variations')

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
        const err = await res.json().catch(() => ({})) as { error?: string }
        const queued = pendingApprovalFrom(err)
        alert(queued ? `Waiting for approval: ${queued.message.replace(/^Sent for approval:\s*/, '')}` : err.error ?? 'Failed to create invoice')
        return
      }
      const { invoice: newInvoice } = await res.json() as { invoice: { id: string } }
      await load()
      onInvoiceUpdated?.()
      // Auto-expand and edit these types so they open ready to edit line items
      if ((type === 'make_safe' || type === 'custom' || type === 'quoted_amounts' || type === 'variations') && newInvoice?.id) {
        setExpandedInvoiceId(newInvoice.id)
        setEditingInvoiceId(newInvoice.id)
      }
    } catch {
      alert('Failed to create invoice. Please try again.')
    } finally {
      setCreating(false)
    }
  }, [jobId, tenantId, load, onInvoiceUpdated])

  // ── Invoice date handler — editable while draft, locked once sent ─────────

  const handleIssuedDateChange = useCallback(async (invoiceId: string, value: string) => {
    if (!value) return
    setInvoices(prev => prev.map(i => i.id === invoiceId ? { ...i, issued_date: value } : i))
    await fetch(`/api/invoices/${invoiceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, issued_date: value }),
    })
    load()
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
      <div style={{ padding: '32px 0', textAlign: 'center', fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: 'var(--subtle)' }}>
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
            style={{ background: 'var(--paper)', borderRadius: 12, padding: '28px 32px', maxWidth: 440, width: '90%', fontFamily: 'DM Sans, sans-serif', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--body)', marginBottom: 20 }}>Create Invoice</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Assessment (BAR) */}
              <button
                disabled={!barReport || hasAssessment}
                onClick={() => createInvoice('assessment', { reportId: barReport?.id })}
                style={{
                  textAlign: 'left', padding: '12px 16px', border: '1px solid var(--line)',
                  borderRadius: 8, background: (!barReport || hasAssessment) ? 'var(--surface)' : 'var(--paper)',
                  cursor: (!barReport || hasAssessment) ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: (!barReport || hasAssessment) ? 'var(--subtle)' : 'var(--body)' }}>
                  Assessment (BAR)
                </div>
                <div style={{ fontSize: 11, color: 'var(--subtle)', marginTop: 2 }}>
                  {!barReport ? 'No BAR report exists for this job' : hasAssessment ? 'Assessment invoice already exists' : 'Single charge from rate config'}
                </div>
              </button>

              {/* Make Safe */}
              <button
                disabled={!makeSafeReport || hasMakeSafe}
                onClick={() => createInvoice('make_safe', { reportId: makeSafeReport?.id })}
                style={{
                  textAlign: 'left', padding: '12px 16px', border: '1px solid var(--line)',
                  borderRadius: 8, background: (!makeSafeReport || hasMakeSafe) ? 'var(--surface)' : 'var(--paper)',
                  cursor: (!makeSafeReport || hasMakeSafe) ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: (!makeSafeReport || hasMakeSafe) ? 'var(--subtle)' : 'var(--body)' }}>
                  Make Safe
                </div>
                <div style={{ fontSize: 11, color: 'var(--subtle)', marginTop: 2 }}>
                  {!makeSafeReport ? 'No make safe report exists for this job' : hasMakeSafe ? 'Make safe invoice already exists' : 'Single charge from rate config'}
                </div>
              </button>

              {/* Roof Report */}
              <button
                disabled={!roofReport || hasRoof}
                onClick={() => createInvoice('roof', { reportId: roofReport?.id })}
                style={{
                  textAlign: 'left', padding: '12px 16px', border: '1px solid var(--line)',
                  borderRadius: 8, background: (!roofReport || hasRoof) ? 'var(--surface)' : 'var(--paper)',
                  cursor: (!roofReport || hasRoof) ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: (!roofReport || hasRoof) ? 'var(--subtle)' : 'var(--body)' }}>
                  Roof Report
                </div>
                <div style={{ fontSize: 11, color: 'var(--subtle)', marginTop: 2 }}>
                  {!roofReport ? 'No roof report exists for this job' : hasRoof ? 'Roof invoice already exists' : 'Single charge from rate config'}
                </div>
              </button>

              {/* Leak Detection Report */}
              <button
                disabled={!leakDetectionReport || hasLeakDetection}
                onClick={() => createInvoice('leak_detection', { reportId: leakDetectionReport?.id })}
                style={{
                  textAlign: 'left', padding: '12px 16px', border: '1px solid var(--line)',
                  borderRadius: 8, background: (!leakDetectionReport || hasLeakDetection) ? 'var(--surface)' : 'var(--paper)',
                  cursor: (!leakDetectionReport || hasLeakDetection) ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: (!leakDetectionReport || hasLeakDetection) ? 'var(--subtle)' : 'var(--body)' }}>
                  Leak Detection Report
                </div>
                <div style={{ fontSize: 11, color: 'var(--subtle)', marginTop: 2 }}>
                  {!leakDetectionReport ? 'No leak detection report exists for this job' : hasLeakDetection ? 'Leak detection invoice already exists' : 'Single charge from rate config'}
                </div>
              </button>

              {/* Excess */}
              <button
                disabled={!job.excess || hasExcess}
                onClick={() => createInvoice('excess', { excessAmountIncGst: job.excess! })}
                style={{
                  textAlign: 'left', padding: '12px 16px', border: '1px solid var(--line)',
                  borderRadius: 8, background: (!job.excess || hasExcess) ? 'var(--surface)' : 'var(--paper)',
                  cursor: (!job.excess || hasExcess) ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: (!job.excess || hasExcess) ? 'var(--subtle)' : 'var(--body)' }}>
                  Excess
                </div>
                <div style={{ fontSize: 11, color: 'var(--subtle)', marginTop: 2 }}>
                  {!job.excess ? 'No excess amount on this job' : hasExcess ? 'Excess invoice already exists' : `${fmt(job.excess)} (inc GST)`}
                </div>
              </button>

              {/* Quoted Amounts */}
              <button
                disabled={!approvedQuotes.length || hasQuotedAmounts}
                onClick={() => createInvoice('quoted_amounts')}
                style={{
                  textAlign: 'left', padding: '12px 16px', border: '1px solid var(--line)',
                  borderRadius: 8, background: (!approvedQuotes.length || hasQuotedAmounts) ? 'var(--surface)' : 'var(--paper)',
                  cursor: (!approvedQuotes.length || hasQuotedAmounts) ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: (!approvedQuotes.length || hasQuotedAmounts) ? 'var(--subtle)' : 'var(--body)' }}>
                  Quoted Amounts
                </div>
                <div style={{ fontSize: 11, color: 'var(--subtle)', marginTop: 2 }}>
                  {!approvedQuotes.length
                    ? 'No approved quotes for this job'
                    : hasQuotedAmounts
                      ? 'Quoted amounts invoice already exists'
                      : `${approvedQuotes.length} approved quote${approvedQuotes.length > 1 ? 's' : ''} — scope items pre-filled`}
                </div>
              </button>

              {/* Additional Items / Variations */}
              <button
                disabled={!hasAdditionalItems || hasVariations}
                onClick={() => createInvoice('variations')}
                style={{
                  textAlign: 'left', padding: '12px 16px', border: '1px solid var(--line)',
                  borderRadius: 8, background: (!hasAdditionalItems || hasVariations) ? 'var(--surface)' : 'var(--paper)',
                  cursor: (!hasAdditionalItems || hasVariations) ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: (!hasAdditionalItems || hasVariations) ? 'var(--subtle)' : 'var(--body)' }}>
                  Additional Items / Variations
                </div>
                <div style={{ fontSize: 11, color: 'var(--subtle)', marginTop: 2 }}>
                  {!hasAdditionalItems
                    ? 'No additional works or variations in work orders'
                    : hasVariations
                      ? 'Variations invoice already exists'
                      : 'Pre-filled from work order additional items'}
                </div>
              </button>

              {/* Custom */}
              <button
                onClick={() => createInvoice('custom')}
                style={{
                  textAlign: 'left', padding: '12px 16px', border: '1px solid var(--line)',
                  borderRadius: 8, background: 'var(--paper)',
                  cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--body)' }}>Custom</div>
                <div style={{ fontSize: 11, color: 'var(--subtle)', marginTop: 2 }}>
                  Blank invoice with custom line items and builder&apos;s margin
                </div>
              </button>
            </div>

            <button
              onClick={() => setCreateModalOpen(false)}
              style={{ marginTop: 20, fontFamily: 'DM Sans, sans-serif', fontSize: 12, color: 'var(--subtle)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--body)' }}>
          Invoices ({invoices.length})
        </div>
        <button
          onClick={() => setCreateModalOpen(true)}
          disabled={creating}
          style={{
            fontFamily: 'DM Sans, sans-serif', fontSize: 13, fontWeight: 500,
            color: 'var(--paper)', background: 'var(--body)', border: 'none', borderRadius: 6,
            padding: '8px 16px', cursor: creating ? 'not-allowed' : 'pointer',
            opacity: creating ? 0.6 : 1,
          }}
        >
          {creating ? 'Creating…' : '+ Create Invoice'}
        </button>
      </div>

      {/* Empty state */}
      {invoices.length === 0 && (
        <div style={{ padding: '48px 24px', textAlign: 'center', background: 'var(--surface)', borderRadius: 8 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
          <div style={{ fontSize: 14, color: 'var(--body)', marginBottom: 4 }}>No invoices yet</div>
          <div style={{ fontSize: 12, color: 'var(--subtle)' }}>Create an invoice to track payments for this job</div>
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
              background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 8,
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
                // These types open directly in edit mode so users can tick/delete line items
                if (isExpanding && (invoice.invoice_type === 'make_safe' || invoice.invoice_type === 'custom' || invoice.invoice_type === 'quoted_amounts' || invoice.invoice_type === 'variations') && invoice.status === 'draft') {
                  setEditingInvoiceId(invoice.id)
                }
              }}
            >
              {/* Invoice ref */}
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--body)', flex: 1 }}>
                {invoice.invoice_ref ?? 'Draft Invoice'}
              </div>

              {/* Type badge */}
              <div style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: 'var(--line-tan-4)', color: 'var(--body)' }}>
                {TYPE_LABELS[invoice.invoice_type] ?? invoice.invoice_type}
              </div>

              {/* Status badge */}
              <div style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: statusStyle.bg, color: statusStyle.text }}>
                {statusLabel}
              </div>

              {/* Amount */}
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--body)', minWidth: 90, textAlign: 'right' }}>
                {fmt(invoice.amount_inc_gst ?? 0)}
              </div>

              {/* Expand/collapse icon */}
              <div style={{ fontSize: 12, color: 'var(--subtle)', transition: 'transform 0.2s', transform: expandedInvoiceId === invoice.id ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                ▼
              </div>

              {/* Quick send button for drafts */}
              {invoice.status === 'draft' && (
                <button
                  onClick={(e) => { e.stopPropagation(); setSendInvoiceId(invoice.id) }}
                  style={{
                    fontSize: 11, fontWeight: 500, color: 'var(--paper)', background: 'var(--body)',
                    border: 'none', borderRadius: 4, padding: '5px 10px',
                    cursor: 'pointer',
                  }}
                >
                  Send
                </button>
              )}

              {/* 3-dot menu */}
              <div style={{ position: 'relative' }} data-menu-dropdown>
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuDropdownId(menuDropdownId === invoice.id ? null : invoice.id) }}
                  style={{ fontSize: 16, color: 'var(--subtle)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px' }}
                >
                  •••
                </button>

                {menuDropdownId === invoice.id && (
                  <div style={{
                    position: 'absolute', top: '100%', right: 0, marginTop: 4,
                    background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 6,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 100, minWidth: 150,
                  }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); window.open(`/print/invoices/${invoice.id}`, '_blank'); setMenuDropdownId(null) }}
                      style={{ width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 13, color: 'var(--body)', background: 'none', border: 'none', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      PDF Preview
                    </button>
                    {invoice.status !== 'voided' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setSendInvoiceId(invoice.id); setMenuDropdownId(null) }}
                        style={{ width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 13, color: 'var(--body)', background: 'none', border: 'none', cursor: 'pointer' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        Email Invoice…
                      </button>
                    )}
                    {invoice.status === 'draft' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(invoice.id, invoice.invoice_ref); setMenuDropdownId(null) }}
                        style={{ width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 13, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', borderTop: '1px solid var(--line)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--danger-bg)')}
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
              <div style={{ borderTop: '1px solid var(--line)', padding: '16px' }}>
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
                      {/* Invoice date — editable while draft, locked once sent */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <span style={{ fontSize: 12, color: 'var(--subtle)' }}>Invoice Date</span>
                        {invoice.status === 'draft' ? (
                          <input
                            type="date"
                            defaultValue={invoice.issued_date ? invoice.issued_date.slice(0, 10) : ''}
                            onChange={e => handleIssuedDateChange(invoice.id, e.target.value)}
                            style={{ fontSize: 13, color: 'var(--body)', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 4, padding: '4px 8px', fontFamily: 'DM Sans, sans-serif' }}
                          />
                        ) : (
                          <span style={{ fontSize: 13, color: 'var(--body)', fontWeight: 500 }}>{fmtDate(invoice.issued_date)}</span>
                        )}
                      </div>

                      {/* Line items preview — grouped by quote when an invoice spans more than one */}
                      {invoice.line_items.length > 0 ? (
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ fontSize: 12, color: 'var(--subtle)', marginBottom: 8 }}>Line Items</div>
                          {(() => {
                            const groups = groupLineItemsByQuote(invoice.line_items)
                            const showGroupHeadings = groups.length > 1
                            return groups.map((group, groupIndex) => (
                              <div key={group.label + groupIndex}>
                                {showGroupHeadings && (
                                  <div style={{ padding: '6px 0', fontSize: 10, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--subtle)' }}>
                                    {group.label}
                                  </div>
                                )}
                                {group.items.map((item) => (
                                  <div
                                    key={item.id}
                                    style={{
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      padding: '8px 0',
                                      fontSize: 13,
                                      color: 'var(--body)',
                                      borderBottom: '1px solid var(--line-tan-4)',
                                    }}
                                  >
                                    <div style={{ flex: 1 }}>{item.description}</div>
                                    <div style={{ minWidth: 60, textAlign: 'right' }}>{item.quantity}</div>
                                    <div style={{ minWidth: 90, textAlign: 'right', fontWeight: 500 }}>{fmt(item.line_total)}</div>
                                  </div>
                                ))}
                              </div>
                            ))
                          })()}
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, color: 'var(--subtle)', marginBottom: 16 }}>No line items</div>
                      )}

                      {/* Deductions preview — read-only; edited from the invoice editor */}
                      {invoice.deductions.length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ fontSize: 12, color: 'var(--subtle)', marginBottom: 8 }}>Deductions</div>
                          {invoice.deductions.map((deduction) => (
                            <div
                              key={deduction.id}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                padding: '8px 0',
                                fontSize: 13,
                                color: 'var(--body)',
                                borderBottom: '1px solid var(--line-tan-4)',
                              }}
                            >
                              <div style={{ flex: 1 }}>{deduction.description || 'Deduction'}</div>
                              <div style={{ minWidth: 90, textAlign: 'right', fontWeight: 500, color: 'var(--danger)' }}>{fmt(-deduction.amount_inc_gst)}</div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Totals */}
                      {(invoice.invoice_type === 'make_safe' || invoice.invoice_type === 'custom' || invoice.invoice_type === 'quoted_amounts' || invoice.invoice_type === 'variations') && (() => {
                        const lineSub = invoice.line_items.reduce((s, i) => s + i.line_total, 0)
                        const pct = invoice.markup_pct ?? 0
                        const markup = Math.round(lineSub * pct * 100) / 100
                        return (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: 'var(--subtle)' }}>
                              <span>Subtotal</span>
                              <span style={{ color: 'var(--body)', fontSize: 13 }}>{fmt(lineSub)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: 'var(--subtle)' }}>
                              <span>Builder&apos;s Margin ({(pct * 100).toFixed(1)}%)</span>
                              <span style={{ color: 'var(--body)', fontSize: 13 }}>{fmt(markup)}</span>
                            </div>
                          </>
                        )
                      })()}
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: 'var(--subtle)' }}>
                        <span>Subtotal (ex GST)</span>
                        <span style={{ color: 'var(--body)', fontSize: 13 }}>{fmt(invoice.amount_ex_gst ?? 0)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: 'var(--subtle)' }}>
                        <span>GST (10%)</span>
                        <span style={{ color: 'var(--body)', fontSize: 13 }}>{fmt(invoice.gst ?? 0)}</span>
                      </div>
                      {(() => {
                        const excessDeduction = invoice.invoice_type === 'quoted_amounts'
                          ? Math.round(invoice.deductions.reduce((sum, d) => sum + (d.amount_inc_gst ?? 0), 0) * 100) / 100
                          : 0
                        if (excessDeduction > 0) {
                          const grossIncGst = (invoice.amount_ex_gst ?? 0) + (invoice.gst ?? 0)
                          return (
                            <>
                              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--line)', marginBottom: 8 }}>
                                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--body)' }}>Total (inc GST)</span>
                                <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--body)' }}>{fmt(grossIncGst)}</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                <span style={{ fontSize: 12, color: 'var(--subtle)' }}>Less: Excess payment received</span>
                                <span style={{ fontSize: 13, color: 'var(--danger)' }}>{fmt(-excessDeduction)}</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '2px solid var(--body)' }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--body)' }}>Final Invoice Total (inc GST)</span>
                                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--body)' }}>{fmt(invoice.amount_inc_gst ?? 0)}</span>
                              </div>
                            </>
                          )
                        }
                        return (
                          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--line)' }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--body)' }}>Total (inc GST)</span>
                            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--body)' }}>{fmt(invoice.amount_inc_gst ?? 0)}</span>
                          </div>
                        )
                      })()}

                      {/* Edit button */}
                      {invoice.status === 'draft' && (
                        <button
                          onClick={() => setEditingInvoiceId(invoice.id)}
                          style={{
                            marginTop: 16,
                            fontFamily: 'DM Sans, sans-serif',
                            fontSize: 13,
                            color: 'var(--body)',
                            background: 'var(--paper)',
                            border: '1px solid var(--line)',
                            borderRadius: 6,
                            padding: '8px 16px',
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = 'var(--tan)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = 'var(--line)'
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
          marginTop: 20, background: 'var(--surface-4)', border: '1px solid var(--line)', borderRadius: 8,
          padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16,
        }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--subtle)', marginBottom: 4 }}>Approved Quote</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--body)' }}>
              {approvedAmount > 0 ? fmt(approvedAmount) : '—'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--subtle)', marginBottom: 4 }}>Total Invoiced</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--body)' }}>{fmt(totalInvoiced)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--subtle)', marginBottom: 4 }}>Balance Remaining</div>
            <div style={{
              fontSize: 15, fontWeight: 600,
              color: balance < 0 ? 'var(--danger)' : balance === 0 ? 'var(--success)' : 'var(--body)',
            }}>
              {approvedAmount > 0 ? fmt(balance) : '—'}
            </div>
          </div>
        </div>
      )}

      {/* Email the invoice (Send), or just mark it sent as the Send button used to */}
      {sendInvoiceId && (
        <SendDocumentModal
          documents={[{ kind: 'invoice', id: sendInvoiceId }]}
          title="Send invoice"
          allowMarkSent={invoices.find(i => i.id === sendInvoiceId)?.status === 'draft'}
          markSentDescription="Mark the invoice as sent and sync it to Xero, without emailing it (what Send did before)."
          onClose={() => setSendInvoiceId(null)}
          onDone={() => { setSendInvoiceId(null); load() }}
        />
      )}
    </div>
  )
}
