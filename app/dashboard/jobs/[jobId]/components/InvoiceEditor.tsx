'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

interface JobInfo {
  job_number: string
  insurer: string | null
  insured_name: string | null
  property_address: string | null
}

interface Invoice {
  id: string
  invoice_type: string
  amount_ex_gst: number
  gst: number
  amount_inc_gst: number
  markup_pct: number | null
}

interface InvoiceLineItem {
  id: string
  description: string
  quantity: number
  unit_price: number
  line_total: number
  sort_order: number
  completed?: boolean | null
}

interface InvoiceEditorProps {
  jobId: string
  invoiceId: string
  tenantId: string
  job: JobInfo
  onInvoiceUpdated?: () => void
}

function fmt(v: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)
}

export function InvoiceEditor({ jobId, invoiceId, tenantId, job, onInvoiceUpdated }: InvoiceEditorProps) {
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([])
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved')

  const supabase = useMemo(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ), [])

  // ── Computed totals ─────────────────────────────────────────────────────────

  const hasBuilderMargin = (invoice?.markup_pct ?? 0) > 0
  const markupPct = invoice?.markup_pct ?? 0
  const activeItems = lineItems.filter(i => i.completed !== false)
  const lineSubtotal = activeItems.reduce((sum, item) => sum + item.line_total, 0)
  const markupAmount = hasBuilderMargin ? Math.round(lineSubtotal * markupPct * 100) / 100 : 0
  const exGst = Math.round((lineSubtotal + markupAmount) * 100) / 100
  const gstAmount = invoice?.invoice_type === 'excess' ? (invoice.gst ?? 0) : Math.round(exGst * 0.10 * 100) / 100
  const total = invoice?.invoice_type === 'excess' ? (invoice.amount_inc_gst ?? 0) : Math.round((exGst + gstAmount) * 100) / 100

  // ── Load invoice + line items ───────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: invoiceData, error: invoiceError } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', invoiceId)
        .eq('tenant_id', tenantId)
        .single()

      if (invoiceError) throw invoiceError
      setInvoice(invoiceData as Invoice)

      const { data: items, error } = await supabase
        .from('invoice_line_items')
        .select('*')
        .eq('invoice_id', invoiceId)
        .eq('tenant_id', tenantId)
        .order('sort_order', { ascending: true })

      if (error) throw error
      setLineItems(items ?? [])
    } catch (error) {
      console.error('Error loading invoice items:', error)
    } finally {
      setLoading(false)
    }
  }, [invoiceId, tenantId])

  useEffect(() => { load() }, [load])

  // ── Persist recalculated totals to DB ───────────────────────────────────────

  const persistTotals = useCallback(async (items: InvoiceLineItem[], currentMarkupPct: number, invType: string) => {
    if (invType === 'excess') return

    const sub = Math.round(items.filter(i => i.completed !== false).reduce((s, i) => s + i.line_total, 0) * 100) / 100
    const markup = currentMarkupPct > 0 ? Math.round(sub * currentMarkupPct * 100) / 100 : 0
    const ex = Math.round((sub + markup) * 100) / 100
    const g = Math.round(ex * 0.10 * 100) / 100
    const inc = Math.round((ex + g) * 100) / 100

    await supabase
      .from('invoices')
      .update({ amount_ex_gst: ex, gst: g, amount_inc_gst: inc })
      .eq('id', invoiceId)
      .eq('tenant_id', tenantId)

    setInvoice(prev => prev ? { ...prev, amount_ex_gst: ex, gst: g, amount_inc_gst: inc } : prev)
  }, [invoiceId, tenantId])

  // ── Update builder's margin ─────────────────────────────────────────────────

  const updateMarkupPct = useCallback(async (pct: number) => {
    if (!invoice) return
    const decimal = pct / 100
    setSaveStatus('saving')
    try {
      await supabase
        .from('invoices')
        .update({ markup_pct: decimal })
        .eq('id', invoiceId)
        .eq('tenant_id', tenantId)

      setInvoice(prev => prev ? { ...prev, markup_pct: decimal } : prev)
      await persistTotals(lineItems, decimal, invoice.invoice_type)
      setSaveStatus('saved')
      onInvoiceUpdated?.()
    } catch {
      setSaveStatus('error')
    }
  }, [invoice, lineItems, invoiceId, tenantId, persistTotals, onInvoiceUpdated])

  // ── Toggle line item completed ──────────────────────────────────────────────

  const toggleCompleted = useCallback(async (itemId: string, completed: boolean) => {
    if (!invoice) return
    const newItems = lineItems.map(i => i.id === itemId ? { ...i, completed } : i)
    setLineItems(newItems)
    setSaveStatus('saving')
    try {
      await supabase
        .from('invoice_line_items')
        .update({ completed })
        .eq('id', itemId)
        .eq('tenant_id', tenantId)

      await persistTotals(newItems, markupPct, invoice.invoice_type)
      setSaveStatus('saved')
      onInvoiceUpdated?.()
    } catch {
      setSaveStatus('error')
    }
  }, [lineItems, tenantId, invoice, markupPct, persistTotals, onInvoiceUpdated])

  // ── Update line item ────────────────────────────────────────────────────────

  const updateItem = useCallback(async (itemId: string, changes: Partial<InvoiceLineItem>) => {
    const item = lineItems.find(i => i.id === itemId)
    if (!item || !invoice) return

    const updated = { ...item, ...changes }
    if ('quantity' in changes) {
      updated.line_total = Math.round(updated.quantity * updated.unit_price * 100) / 100
    }

    const newItems = lineItems.map(i => i.id === itemId ? updated : i)
    setLineItems(newItems)
    setSaveStatus('saving')

    try {
      const updateData: Record<string, unknown> = { ...changes }
      if ('quantity' in changes) {
        updateData.line_total = updated.line_total
      }

      await supabase
        .from('invoice_line_items')
        .update(updateData)
        .eq('id', itemId)
        .eq('tenant_id', tenantId)

      await persistTotals(newItems, markupPct, invoice.invoice_type)
      setSaveStatus('saved')
      onInvoiceUpdated?.()
    } catch (error) {
      console.error('Error updating item:', error)
      setSaveStatus('error')
    }
  }, [lineItems, tenantId, invoice, markupPct, persistTotals, onInvoiceUpdated])

  // ── Add line item ───────────────────────────────────────────────────────────

  const addItem = useCallback(async () => {
    if (!invoice) return
    const maxSort = lineItems.length > 0 ? Math.max(...lineItems.map(i => i.sort_order)) : 0

    const { data: newItem, error } = await supabase
      .from('invoice_line_items')
      .insert({
        tenant_id: tenantId,
        invoice_id: invoiceId,
        description: '',
        quantity: 1,
        unit_price: 0,
        line_total: 0,
        sort_order: maxSort + 1,
      })
      .select('*')
      .single()

    if (error) { console.error('Error adding item:', error); return }
    setLineItems(prev => [...prev, newItem])
    onInvoiceUpdated?.()
  }, [lineItems, tenantId, invoiceId, invoice, onInvoiceUpdated])

  // ── Delete line item ────────────────────────────────────────────────────────

  const deleteItem = useCallback(async (itemId: string) => {
    if (!invoice) return
    if (!window.confirm('Delete this line item?')) return

    await supabase
      .from('invoice_line_items')
      .delete()
      .eq('id', itemId)
      .eq('tenant_id', tenantId)

    const newItems = lineItems.filter(item => item.id !== itemId)
    setLineItems(newItems)
    await persistTotals(newItems, markupPct, invoice.invoice_type)
    onInvoiceUpdated?.()
  }, [lineItems, tenantId, invoice, markupPct, persistTotals, onInvoiceUpdated])

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#9e998f' }}>
        Loading invoice…
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'DM Sans, sans-serif' }}>
      {/* Line items */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: '#9e998f', marginBottom: 8 }}>Line Items</div>

        {lineItems.length === 0 ? (
          <div style={{ padding: '20px', background: '#f5f2ee', borderRadius: 6, textAlign: 'center', fontSize: 13, color: '#9e998f' }}>
            No line items yet. Add items to build your invoice.
          </div>
        ) : (
          <div style={{ background: '#ffffff', borderRadius: 6, overflow: 'hidden', border: '1px solid #e0dbd4' }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '20px 3fr 1fr 1fr 40px', gap: 12, padding: '10px 16px', fontSize: 11, fontWeight: 600, color: '#9e998f', borderBottom: '1px solid #e0dbd4', background: '#fafaf8' }}>
              <div />
              <div>Description</div>
              <div style={{ textAlign: 'right' }}>Qty</div>
              <div style={{ textAlign: 'right' }}>Total</div>
              <div />
            </div>

            {lineItems.map((item, index) => {
              const isIncomplete = item.completed === false
              return (
                <div
                  key={item.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '20px 3fr 1fr 1fr 40px',
                    gap: 12,
                    padding: '12px 16px',
                    fontSize: 13,
                    borderBottom: index < lineItems.length - 1 ? '1px solid #e8e0d0' : 'none',
                    alignItems: 'center',
                    background: isIncomplete ? '#fafaf8' : 'transparent',
                  }}
                >
                  {/* Completed checkbox */}
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={!isIncomplete}
                      onChange={e => toggleCompleted(item.id, e.target.checked)}
                      title={isIncomplete ? 'Mark as completed' : 'Mark as not completed'}
                      style={{ cursor: 'pointer', width: 14, height: 14, accentColor: '#3a3530' }}
                    />
                  </div>

                  {/* Description */}
                  <div>
                    {isIncomplete ? (
                      <span style={{ fontSize: 13, color: '#9e998f', textDecoration: 'line-through' }}>
                        {item.description || 'Item description'}
                      </span>
                    ) : (
                      <input
                        type="text"
                        value={item.description}
                        onChange={(e) => updateItem(item.id, { description: e.target.value })}
                        placeholder="Item description"
                        style={{ width: '100%', fontSize: 13, color: '#3a3530', background: 'transparent', border: 'none', padding: 0, fontFamily: 'DM Sans, sans-serif' }}
                      />
                    )}
                  </div>

                  {/* Qty */}
                  <div style={{ textAlign: 'right' }}>
                    {isIncomplete ? (
                      <span style={{ fontSize: 13, color: '#9e998f', textDecoration: 'line-through' }}>{item.quantity}</span>
                    ) : (
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateItem(item.id, { quantity: parseFloat(e.target.value) || 0 })}
                        min="0"
                        step="0.01"
                        style={{ width: '60px', fontSize: 13, color: '#3a3530', background: '#f5f2ee', border: '1px solid #e0dbd4', borderRadius: 4, padding: '4px 8px', textAlign: 'right', fontFamily: 'DM Sans, sans-serif' }}
                      />
                    )}
                  </div>

                  {/* Line total */}
                  <div style={{ textAlign: 'right' }}>
                    {isIncomplete ? (
                      <span style={{ fontSize: 13, color: '#9e998f', textDecoration: 'line-through' }}>{fmt(item.line_total)}</span>
                    ) : (
                      <input
                        type="number"
                        value={item.line_total}
                        onChange={(e) => updateItem(item.id, { line_total: parseFloat(e.target.value) || 0 })}
                        min="0"
                        step="0.01"
                        style={{ width: '90px', fontSize: 13, color: '#3a3530', background: '#f5f2ee', border: '1px solid #e0dbd4', borderRadius: 4, padding: '4px 8px', textAlign: 'right', fontFamily: 'DM Sans, sans-serif' }}
                      />
                    )}
                  </div>

                  {/* Delete */}
                  <div style={{ textAlign: 'right' }}>
                    <button
                      onClick={() => deleteItem(item.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c0bab3', fontSize: 14, padding: '2px', borderRadius: 3 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = '#c5221f')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = '#c0bab3')}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add item button */}
      <button
        onClick={addItem}
        style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 13, color: '#9e998f', background: '#ffffff', border: '1px solid #e0dbd4', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', marginBottom: 20 }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#c8b89a'; e.currentTarget.style.color = '#3a3530' }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e0dbd4'; e.currentTarget.style.color = '#9e998f' }}
      >
        + Add Line Item
      </button>

      {/* Totals */}
      <div style={{ background: '#ffffff', border: '1px solid #e0dbd4', borderRadius: 6, padding: '16px' }}>
        {hasBuilderMargin && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: '#9e998f' }}>Subtotal</span>
              <span style={{ fontSize: 13, color: '#3a3530' }}>{fmt(lineSubtotal)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: '#9e998f', display: 'flex', alignItems: 'center', gap: 6 }}>
                Builder&apos;s Margin
                {invoice?.invoice_type === 'quoted_amounts' ? (
                  <span style={{ fontSize: 12, color: '#9e998f' }}>{(markupPct * 100).toFixed(1)}%</span>
                ) : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <input
                      type="number"
                      key={markupPct}
                      defaultValue={(markupPct * 100).toFixed(1)}
                      min="0"
                      step="0.5"
                      onBlur={(e) => updateMarkupPct(parseFloat(e.target.value) || 0)}
                      style={{ width: 52, fontSize: 12, color: '#3a3530', background: '#f5f2ee', border: '1px solid #e0dbd4', borderRadius: 4, padding: '3px 6px', textAlign: 'right', fontFamily: 'DM Mono, monospace' }}
                    />
                    <span style={{ fontSize: 11, color: '#9e998f' }}>%</span>
                  </span>
                )}
              </span>
              <span style={{ fontSize: 13, color: '#3a3530' }}>{fmt(markupAmount)}</span>
            </div>
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: '#9e998f' }}>Subtotal (ex GST)</span>
          <span style={{ fontSize: 13, color: '#3a3530' }}>{fmt(invoice?.invoice_type === 'excess' ? (invoice.amount_ex_gst ?? 0) : exGst)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: '#9e998f' }}>GST (10%)</span>
          <span style={{ fontSize: 13, color: '#3a3530' }}>{fmt(gstAmount)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid #e0dbd4' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#3a3530' }}>Total (inc GST)</span>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#3a3530' }}>{fmt(total)}</span>
        </div>
        <div style={{ marginTop: 12, fontSize: 11, color: saveStatus === 'saved' ? '#2e7d32' : saveStatus === 'error' ? '#c5221f' : '#9e998f' }}>
          {saveStatus === 'saved' ? '✓ All changes saved' : saveStatus === 'saving' ? 'Saving…' : 'Error saving changes'}
        </div>
      </div>
    </div>
  )
}
