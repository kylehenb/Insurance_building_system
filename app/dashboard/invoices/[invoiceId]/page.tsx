'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─── Types ────────────────────────────────────────────────────────────────────

interface Invoice {
  id: string
  invoice_ref: string | null
  invoice_type: string
  direction: string
  status: string | null
  gst_treatment: string | null
  amount_ex_gst: number | null
  gst: number | null
  amount_inc_gst: number | null
  markup_pct: number | null
  issued_date: string | null
  paid_date: string | null
  notes: string | null
  job_id: string
  report_id: string | null
  work_order_id: string | null
  tenant_id: string
  created_at: string | null
}

interface LineItem {
  id: string
  description: string
  quantity: number
  unit: string | null
  unit_price: number
  line_total: number
  sort_order: number | null
  library_item_id: string | null
}

interface LibraryItem {
  id: string
  description: string
  default_quantity: number | null
  default_unit_price: number | null
  unit: string | null
  invoice_type: string
}

interface JobInfo {
  job_number: string | null
  claim_number: string | null
  insurer: string | null
  insured_name: string | null
  property_address: string | null
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
  excess: 'Excess (GST-inclusive)',
  balance: 'Balance',
  progress: 'Progress',
  standard: 'Standard',
}

const LOCKED_TYPES = new Set(['assessment', 'excess', 'balance'])

function fmt(v: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function InvoiceDetailPage() {
  const router = useRouter()
  const params = useParams<{ invoiceId: string }>()
  const invoiceId = params?.invoiceId ?? ''

  const [tenantId, setTenantId] = useState<string | null>(null)
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [job, setJob] = useState<JobInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved')

  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([])
  const [libraryOpen, setLibraryOpen] = useState(false)
  const libraryRef = useRef<HTMLDivElement>(null)

  // ── Auth bootstrap ────────────────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: profile } = await supabase
        .from('users').select('tenant_id').eq('id', user.id).single()
      if (!profile) { router.push('/login'); return }
      setTenantId((profile as { tenant_id: string }).tenant_id)
    }
    init()
  }, [router])

  // ── Data loading ──────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!tenantId || !invoiceId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}?tenantId=${tenantId}`)
      if (!res.ok) { router.push('/dashboard/invoices'); return }
      const { invoice: inv, lineItems: items } = await res.json() as { invoice: Invoice; lineItems: LineItem[] }
      setInvoice(inv)
      setLineItems(items)

      // Load job info
      const { data: jobData } = await supabase
        .from('jobs')
        .select('job_number, claim_number, insurer, insured_name, property_address')
        .eq('id', inv.job_id)
        .eq('tenant_id', tenantId)
        .single()
      setJob(jobData ?? null)

      // Load library items for this invoice type
      if (!LOCKED_TYPES.has(inv.invoice_type)) {
        const libRes = await fetch(`/api/invoice-library?tenantId=${tenantId}&type=${inv.invoice_type}`)
        if (libRes.ok) setLibraryItems(await libRes.json() as LibraryItem[])
      }
    } finally {
      setLoading(false)
    }
  }, [tenantId, invoiceId, router])

  useEffect(() => {
    if (!tenantId) return
    load()
  }, [tenantId, load])

  // ── Close library popover on outside click ────────────────────────────────

  useEffect(() => {
    if (!libraryOpen) return
    const handler = (e: MouseEvent) => {
      if (libraryRef.current && !libraryRef.current.contains(e.target as Node)) {
        setLibraryOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [libraryOpen])

  // ── Recalculate totals from line items ────────────────────────────────────

  const recalcTotals = useCallback(async (items: LineItem[], overrideMarkupPct?: number) => {
    if (!invoice || !tenantId) return
    if (invoice.gst_treatment === 'inclusive') return

    const subtotal = Math.round(items.reduce((s, i) => s + i.line_total, 0) * 100) / 100
    let exGst = subtotal

    if (invoice.invoice_type === 'make_safe') {
      const markupPct = overrideMarkupPct ?? (invoice.markup_pct ?? 0)
      const markup = Math.round(subtotal * markupPct * 100) / 100
      exGst = Math.round((subtotal + markup) * 100) / 100
    }

    const gst = Math.round(exGst * 0.1 * 100) / 100
    const incGst = Math.round((exGst + gst) * 100) / 100

    await supabase
      .from('invoices')
      .update({ amount_ex_gst: exGst, gst, amount_inc_gst: incGst })
      .eq('id', invoice.id)
      .eq('tenant_id', tenantId)

    setInvoice(prev => prev ? { ...prev, amount_ex_gst: exGst, gst, amount_inc_gst: incGst } : prev)
  }, [invoice, tenantId])

  // ── Update builder's margin (make_safe only) ──────────────────────────────

  const updateMarkupPct = useCallback(async (pct: number) => {
    if (!tenantId || !invoice || invoice.invoice_type !== 'make_safe') return
    const markupPct = pct / 100

    await supabase
      .from('invoices')
      .update({ markup_pct: markupPct })
      .eq('id', invoice.id)
      .eq('tenant_id', tenantId)

    setInvoice(prev => prev ? { ...prev, markup_pct: markupPct } : prev)
    await recalcTotals(lineItems, markupPct)
  }, [invoice, tenantId, lineItems, recalcTotals])

  // ── Line item updates ─────────────────────────────────────────────────────

  const updateItem = useCallback(async (itemId: string, field: keyof LineItem, rawValue: string) => {
    if (!tenantId || !invoice) return
    setSaveStatus('saving')

    const item = lineItems.find(i => i.id === itemId)
    if (!item) return

    let value: string | number = rawValue
    if (field === 'quantity' || field === 'unit_price' || field === 'line_total') {
      value = parseFloat(rawValue) || 0
    }

    const updated = { ...item, [field]: value }
    if (field === 'quantity') {
      updated.line_total = Math.round(updated.quantity * updated.unit_price * 100) / 100
    }

    const newItems = lineItems.map(i => i.id === itemId ? updated : i)
    setLineItems(newItems)

    try {
      const patch: Record<string, unknown> = { [field]: value }
      if (field === 'quantity') {
        patch.line_total = updated.line_total
      }

      const { error } = await supabase
        .from('invoice_line_items')
        .update(patch)
        .eq('id', itemId)
        .eq('tenant_id', tenantId)

      if (error) throw error
      await recalcTotals(newItems)
      setSaveStatus('saved')
    } catch {
      setSaveStatus('error')
    }
  }, [lineItems, tenantId, invoice, recalcTotals])

  // ── Delete line item ──────────────────────────────────────────────────────

  const deleteItem = useCallback(async (itemId: string) => {
    if (!tenantId) return
    const { error } = await supabase
      .from('invoice_line_items')
      .delete()
      .eq('id', itemId)
      .eq('tenant_id', tenantId)
    if (error) return

    const newItems = lineItems.filter(i => i.id !== itemId)
    setLineItems(newItems)
    await recalcTotals(newItems)
  }, [lineItems, tenantId, recalcTotals])

  // ── Add custom line item ──────────────────────────────────────────────────

  const addCustomLine = useCallback(async () => {
    if (!tenantId || !invoice) return
    const maxSort = lineItems.length > 0 ? Math.max(...lineItems.map(i => i.sort_order ?? 0)) : -1

    const { data: newItem, error } = await supabase
      .from('invoice_line_items')
      .insert({
        tenant_id: tenantId,
        invoice_id: invoice.id,
        description: '',
        quantity: 1,
        unit_price: 0,
        line_total: 0,
        sort_order: maxSort + 1,
      })
      .select('*')
      .single()

    if (error || !newItem) return
    const cast = newItem as LineItem
    const newItems = [...lineItems, cast]
    setLineItems(newItems)
    await recalcTotals(newItems)
  }, [lineItems, tenantId, invoice, recalcTotals])

  // ── Add from library ──────────────────────────────────────────────────────

  const addFromLibrary = useCallback(async (lib: LibraryItem) => {
    if (!tenantId || !invoice) return
    setLibraryOpen(false)
    const maxSort = lineItems.length > 0 ? Math.max(...lineItems.map(i => i.sort_order ?? 0)) : -1
    const qty = lib.default_quantity ?? 1
    const price = lib.default_unit_price ?? 0
    const lineTotal = Math.round(qty * price * 100) / 100

    const { data: newItem, error } = await supabase
      .from('invoice_line_items')
      .insert({
        tenant_id: tenantId,
        invoice_id: invoice.id,
        description: lib.description,
        quantity: qty,
        unit: lib.unit ?? null,
        unit_price: price,
        line_total: lineTotal,
        library_item_id: lib.id,
        sort_order: maxSort + 1,
      })
      .select('*')
      .single()

    if (error || !newItem) return
    const cast = newItem as LineItem
    const newItems = [...lineItems, cast]
    setLineItems(newItems)
    await recalcTotals(newItems)
  }, [lineItems, tenantId, invoice, recalcTotals])

  // ── Status actions ────────────────────────────────────────────────────────

  const markSent = useCallback(async () => {
    if (!tenantId || !invoice) return
    await fetch(`/api/invoices/${invoice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, status: 'sent', issued_date: new Date().toISOString().split('T')[0] }),
    })
    load()
  }, [tenantId, invoice, load])

  const markPaid = useCallback(async () => {
    if (!tenantId || !invoice) return
    await fetch(`/api/invoices/${invoice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, status: 'paid' }),
    })
    load()
  }, [tenantId, invoice, load])

  const voidInvoice = useCallback(async () => {
    if (!tenantId || !invoice) return
    if (!window.confirm(`Void invoice ${invoice.invoice_ref ?? invoice.id}? This cannot be undone.`)) return
    await fetch(`/api/invoices/${invoice.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId }),
    })
    load()
  }, [tenantId, invoice, load])

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading || !invoice) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#9e998f' }}>
        {loading ? 'Loading…' : 'Invoice not found'}
      </div>
    )
  }

  const isLocked = LOCKED_TYPES.has(invoice.invoice_type) || invoice.status === 'sent' || invoice.status === 'paid' || invoice.status === 'voided'
  const isEditable = invoice.status === 'draft'
  const statusStyle = STATUS_STYLES[invoice.status ?? 'draft'] ?? STATUS_STYLES.draft
  const isInclusive = invoice.gst_treatment === 'inclusive'
  const canAddLines = !LOCKED_TYPES.has(invoice.invoice_type) && isEditable

  // Compute totals display
  const isMakeSafe = invoice.invoice_type === 'make_safe'
  const markupPct = invoice.markup_pct ?? 0
  const subtotalFromLines = lineItems.reduce((s, i) => s + i.line_total, 0)
  const markupAmount = isMakeSafe ? Math.round(subtotalFromLines * markupPct * 100) / 100 : 0
  const exGst = invoice.amount_ex_gst ?? 0
  const gst = invoice.gst ?? 0
  const incGst = invoice.amount_inc_gst ?? 0

  return (
    <>
      <style>{`
        .invd { padding: 32px 36px 48px; font-family: 'DM Sans', sans-serif; color: #3a3530; }
        .invd-header { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; flex-wrap: wrap; }
        .invd-ref { font-size: 20px; font-weight: 700; color: #1a1a1a; font-family: 'DM Mono', monospace; }
        .invd-badge { font-size: 11px; padding: 3px 10px; border-radius: 4px; font-weight: 500; }
        .invd-back { font-size: 12px; color: #9e998f; cursor: pointer; background: none; border: none; font-family: inherit; padding: 0; margin-right: 4px; }
        .invd-back:hover { color: #3a3530; }
        .invd-actions { margin-left: auto; display: flex; gap: 8px; }
        .invd-btn { font-size: 12px; font-weight: 500; padding: 7px 16px; border-radius: 6px; cursor: pointer; font-family: inherit; border: 1px solid transparent; }
        .invd-btn-primary { background: #3a3530; color: #fff; }
        .invd-btn-primary:hover { background: #2a2520; }
        .invd-btn-secondary { background: #fff; color: #3a3530; border-color: #e0dbd4; }
        .invd-btn-secondary:hover { border-color: #c8b89a; }
        .invd-btn-danger { background: #fff; color: #c5221f; border-color: #fce8e6; }
        .invd-btn-danger:hover { background: #fce8e6; }
        .invd-body { display: grid; grid-template-columns: 3fr 2fr; gap: 24px; }
        @media (max-width: 900px) { .invd-body { grid-template-columns: 1fr; } }
        .invd-card { background: #fff; border: 1px solid #e0dbd4; border-radius: 8px; overflow: hidden; }
        .invd-card-title { font-size: 11px; font-weight: 600; color: #9e998f; padding: 12px 16px; border-bottom: 1px solid #e0dbd4; background: #fafaf8; text-transform: uppercase; letter-spacing: 0.5px; }
        .invd-table { width: 100%; border-collapse: collapse; }
        .invd-table th { font-size: 11px; font-weight: 600; color: #9e998f; text-align: left; padding: 10px 12px; border-bottom: 1px solid #e0dbd4; background: #fafaf8; }
        .invd-table th.right { text-align: right; }
        .invd-table td { font-size: 13px; color: #3a3530; padding: 10px 12px; border-bottom: 1px solid #f0ece6; vertical-align: middle; }
        .invd-table tr:last-child td { border-bottom: none; }
        .invd-input { width: 100%; font-size: 13px; color: #3a3530; background: transparent; border: none; padding: 0; font-family: 'DM Sans', sans-serif; }
        .invd-input:focus { outline: 1px solid #c8b89a; border-radius: 3px; background: #fffef9; padding: 2px 4px; }
        .invd-num-input { width: 70px; font-size: 13px; color: #3a3530; background: #f5f2ee; border: 1px solid #e0dbd4; border-radius: 4px; padding: 4px 8px; text-align: right; font-family: 'DM Mono', monospace; }
        .invd-num-input:focus { outline: none; border-color: #c8b89a; }
        .invd-del-btn { background: none; border: none; cursor: pointer; color: #c0bab3; font-size: 14px; padding: 2px 4px; border-radius: 3px; }
        .invd-del-btn:hover { color: #c5221f; }
        .invd-totals { padding: 16px; }
        .invd-total-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; }
        .invd-total-label { font-size: 12px; color: #9e998f; }
        .invd-total-val { font-size: 13px; color: #3a3530; font-family: 'DM Mono', monospace; }
        .invd-total-final { border-top: 1px solid #e0dbd4; margin-top: 8px; padding-top: 12px; }
        .invd-total-final .invd-total-label { font-size: 13px; font-weight: 600; color: #3a3530; }
        .invd-total-final .invd-total-val { font-size: 15px; font-weight: 700; color: #3a3530; }
        .invd-save-status { padding: 10px 16px; font-size: 11px; border-top: 1px solid #e0dbd4; }
        .invd-add-bar { padding: 12px 16px; display: flex; gap: 8px; border-top: 1px solid #e0dbd4; }
        .invd-add-btn { font-size: 12px; font-weight: 500; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-family: inherit; background: #fff; color: #3a3530; border: 1px solid #e0dbd4; }
        .invd-add-btn:hover { border-color: #c8b89a; }
        .invd-meta-row { display: flex; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid #f0ece6; font-size: 13px; }
        .invd-meta-row:last-child { border-bottom: none; }
        .invd-meta-label { color: #9e998f; font-size: 12px; }
        .invd-meta-val { color: #3a3530; font-weight: 500; }
        .invd-inclusive-notice { margin: 0 16px 12px; padding: 10px 14px; background: #fff8e1; border: 1px solid #f0c040; border-radius: 6px; font-size: 12px; color: #b45309; }
        .lib-popover { position: absolute; top: 100%; left: 0; margin-top: 4px; background: #fff; border: 1px solid #e0dbd4; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); z-index: 100; min-width: 260px; max-height: 260px; overflow-y: auto; }
        .lib-item { padding: 10px 14px; font-size: 13px; cursor: pointer; border-bottom: 1px solid #f5f2ee; }
        .lib-item:last-child { border-bottom: none; }
        .lib-item:hover { background: #f5f2ee; }
        .lib-item-name { color: #3a3530; font-weight: 500; }
        .lib-item-meta { font-size: 11px; color: #9e998f; margin-top: 2px; }
        .voided-banner { background: #fce8e6; border: 1px solid #f5a0a0; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #c5221f; margin-bottom: 16px; font-weight: 500; }
      `}</style>

      <div className="invd">
        {/* Header */}
        <div className="invd-header">
          <button className="invd-back" onClick={() => router.push('/dashboard/invoices')}>← Invoices</button>
          <span className="invd-ref">{invoice.invoice_ref ?? 'Draft Invoice'}</span>
          <span className="invd-badge" style={{ background: '#e8e0d0', color: '#3a3530' }}>
            {TYPE_LABELS[invoice.invoice_type] ?? invoice.invoice_type}
          </span>
          <span className="invd-badge" style={{ background: statusStyle.bg, color: statusStyle.text }}>
            {(invoice.status ?? 'draft').charAt(0).toUpperCase() + (invoice.status ?? 'draft').slice(1)}
          </span>
          {job && (
            <span
              style={{ fontSize: 12, color: '#9e998f', cursor: 'pointer', textDecoration: 'underline' }}
              onClick={() => router.push(`/dashboard/jobs/${invoice.job_id}`)}
            >
              {job.job_number ?? 'Job'}
            </span>
          )}
          <div className="invd-actions">
            {invoice.status === 'draft' && (
              <button className="invd-btn invd-btn-primary" onClick={markSent}>Mark as Sent</button>
            )}
            {invoice.status === 'sent' && (
              <>
                <button className="invd-btn invd-btn-secondary" onClick={markPaid}>Record Payment</button>
                <button className="invd-btn invd-btn-danger" onClick={voidInvoice}>Void</button>
              </>
            )}
            {invoice.status === 'draft' && (
              <button className="invd-btn invd-btn-danger" onClick={voidInvoice}>Void</button>
            )}
            <button
              className="invd-btn invd-btn-secondary"
              onClick={() => window.open(`/print/invoices/${invoice.id}`, '_blank')}
            >
              Download PDF
            </button>
          </div>
        </div>

        {invoice.status === 'voided' && (
          <div className="voided-banner">This invoice has been voided and is no longer active.</div>
        )}

        {/* Body */}
        <div className="invd-body">
          {/* Left: Line items */}
          <div>
            <div className="invd-card">
              <div className="invd-card-title">Line Items</div>

              {isInclusive && (
                <div className="invd-inclusive-notice">
                  This invoice uses GST-inclusive pricing. The entered amount already includes GST — ex-GST and GST are derived from the total.
                </div>
              )}

              <table className="invd-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th style={{ width: 60, textAlign: 'right' }}>Qty</th>
                    {!isInclusive && <th style={{ width: 60, textAlign: 'right' }}>Unit</th>}
                    <th style={{ width: 100, textAlign: 'right' }}>Line Total</th>
                    {!isLocked && <th style={{ width: 32 }} />}
                  </tr>
                </thead>
                <tbody>
                  {lineItems.length === 0 && (
                    <tr>
                      <td colSpan={isLocked ? 3 : 4} style={{ textAlign: 'center', color: '#9e998f', padding: '24px' }}>
                        No line items
                      </td>
                    </tr>
                  )}
                  {lineItems.map(item => (
                    <tr key={item.id}>
                      <td>
                        {isLocked ? (
                          <span>{item.description}</span>
                        ) : (
                          <input
                            className="invd-input"
                            defaultValue={item.description}
                            placeholder="Description"
                            onBlur={e => updateItem(item.id, 'description', e.target.value)}
                          />
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {isLocked ? (
                          <span>{item.quantity}</span>
                        ) : (
                          <input
                            className="invd-num-input"
                            defaultValue={item.quantity}
                            type="number"
                            min="0"
                            step="0.01"
                            onBlur={e => updateItem(item.id, 'quantity', e.target.value)}
                          />
                        )}
                      </td>
                      {!isInclusive && (
                        <td style={{ textAlign: 'right' }}>
                          {isLocked ? (
                            <span style={{ fontSize: 12, color: '#9e998f' }}>{item.unit ?? '—'}</span>
                          ) : (
                            <input
                              className="invd-num-input"
                              style={{ width: 50, textAlign: 'center' }}
                              defaultValue={item.unit ?? ''}
                              placeholder="ea"
                              onBlur={e => updateItem(item.id, 'unit', e.target.value)}
                            />
                          )}
                        </td>
                      )}
                      <td style={{ textAlign: 'right', fontWeight: 500 }}>
                        {isLocked ? (
                          <span>{fmt(item.line_total)}</span>
                        ) : (
                          <input
                            className="invd-num-input"
                            defaultValue={item.line_total}
                            type="number"
                            min="0"
                            step="0.01"
                            onBlur={e => updateItem(item.id, 'line_total', e.target.value)}
                          />
                        )}
                      </td>
                      {!isLocked && (
                        <td>
                          <button
                            className="invd-del-btn"
                            onClick={() => deleteItem(item.id)}
                            title="Remove line"
                          >
                            ×
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Add line buttons */}
              {canAddLines && (
                <div className="invd-add-bar">
                  <div style={{ position: 'relative' }} ref={libraryRef}>
                    <button
                      className="invd-add-btn"
                      onClick={() => setLibraryOpen(!libraryOpen)}
                    >
                      + Add from library
                    </button>
                    {libraryOpen && (
                      <div className="lib-popover">
                        {libraryItems.length === 0 ? (
                          <div style={{ padding: '16px', fontSize: 13, color: '#9e998f' }}>
                            No library items — add some in Settings → Invoice Library.
                          </div>
                        ) : (
                          libraryItems.map(lib => (
                            <div key={lib.id} className="lib-item" onClick={() => addFromLibrary(lib)}>
                              <div className="lib-item-name">{lib.description}</div>
                              <div className="lib-item-meta">
                                {lib.default_quantity ?? 1} {lib.unit ?? 'ea'} × {fmt(lib.default_unit_price ?? 0)}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  <button className="invd-add-btn" onClick={addCustomLine}>+ Add custom line</button>
                </div>
              )}

              {/* Save status */}
              <div className="invd-save-status" style={{ color: saveStatus === 'saved' ? '#2e7d32' : saveStatus === 'error' ? '#c5221f' : '#9e998f' }}>
                {saveStatus === 'saved' ? '✓ All changes saved' : saveStatus === 'saving' ? 'Saving…' : 'Error saving changes'}
              </div>
            </div>
          </div>

          {/* Right: Totals + metadata */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Totals */}
            <div className="invd-card">
              <div className="invd-card-title">Totals</div>
              <div className="invd-totals">
                {isMakeSafe && (
                  <>
                    <div className="invd-total-row">
                      <span className="invd-total-label">Subtotal</span>
                      <span className="invd-total-val">{fmt(subtotalFromLines)}</span>
                    </div>
                    <div className="invd-total-row">
                      <span className="invd-total-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        Builder&apos;s Margin
                        {isEditable ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <input
                              className="invd-num-input"
                              style={{ width: 52 }}
                              key={markupPct}
                              defaultValue={(markupPct * 100).toFixed(1)}
                              type="number"
                              min="0"
                              step="0.5"
                              onBlur={e => updateMarkupPct(parseFloat(e.target.value) || 0)}
                            />
                            <span style={{ fontSize: 12, color: '#9e998f' }}>%</span>
                          </span>
                        ) : (
                          <span style={{ color: '#3a3530' }}>({(markupPct * 100).toFixed(1)}%)</span>
                        )}
                      </span>
                      <span className="invd-total-val">{fmt(markupAmount)}</span>
                    </div>
                  </>
                )}
                <div className="invd-total-row">
                  <span className="invd-total-label">Ex GST</span>
                  <span className="invd-total-val">{fmt(exGst)}</span>
                </div>
                <div className="invd-total-row">
                  <span className="invd-total-label">GST (10%)</span>
                  <span className="invd-total-val">{fmt(gst)}</span>
                </div>
                <div className="invd-total-row invd-total-final">
                  <span className="invd-total-label">Total inc GST</span>
                  <span className="invd-total-val">{fmt(incGst)}</span>
                </div>
              </div>
            </div>

            {/* Metadata */}
            <div className="invd-card">
              <div className="invd-card-title">Details</div>
              {job && (
                <>
                  <div className="invd-meta-row">
                    <span className="invd-meta-label">Job</span>
                    <span
                      className="invd-meta-val"
                      style={{ cursor: 'pointer', color: '#1a73e8' }}
                      onClick={() => router.push(`/dashboard/jobs/${invoice.job_id}`)}
                    >
                      {job.job_number ?? '—'}
                    </span>
                  </div>
                  <div className="invd-meta-row">
                    <span className="invd-meta-label">Claim</span>
                    <span className="invd-meta-val">{job.claim_number ?? '—'}</span>
                  </div>
                  <div className="invd-meta-row">
                    <span className="invd-meta-label">Insurer</span>
                    <span className="invd-meta-val">{job.insurer ?? '—'}</span>
                  </div>
                  <div className="invd-meta-row">
                    <span className="invd-meta-label">Insured</span>
                    <span className="invd-meta-val">{job.insured_name ?? '—'}</span>
                  </div>
                </>
              )}
              <div className="invd-meta-row">
                <span className="invd-meta-label">Issued Date</span>
                <span className="invd-meta-val">{fmtDate(invoice.issued_date)}</span>
              </div>
              <div className="invd-meta-row">
                <span className="invd-meta-label">Created</span>
                <span className="invd-meta-val">{fmtDate(invoice.created_at)}</span>
              </div>
              {invoice.paid_date && (
                <div className="invd-meta-row">
                  <span className="invd-meta-label">Paid</span>
                  <span className="invd-meta-val">{fmtDate(invoice.paid_date)}</span>
                </div>
              )}
              {invoice.report_id && (
                <div className="invd-meta-row">
                  <span className="invd-meta-label">Report</span>
                  <span className="invd-meta-val" style={{ fontSize: 11, color: '#9e998f' }}>Linked</span>
                </div>
              )}
              {invoice.work_order_id && (
                <div className="invd-meta-row">
                  <span className="invd-meta-label">Work Order</span>
                  <span className="invd-meta-val" style={{ fontSize: 11, color: '#9e998f' }}>Linked</span>
                </div>
              )}
              {invoice.notes && (
                <div style={{ padding: '10px 16px', fontSize: 12, color: '#3a3530', borderTop: '1px solid #f0ece6' }}>
                  <div style={{ fontSize: 11, color: '#9e998f', marginBottom: 4 }}>Notes</div>
                  {invoice.notes}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
