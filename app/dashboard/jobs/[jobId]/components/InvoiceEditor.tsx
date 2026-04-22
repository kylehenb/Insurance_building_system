'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

interface JobInfo {
  job_number: string
  insurer: string | null
  insured_name: string | null
  property_address: string | null
}

interface InvoiceLineItem {
  id: string
  description: string
  quantity: number
  unit_price: number
  line_total: number
  sort_order: number
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
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [subtotal, setSubtotal] = useState(0)
  const [gst, setGst] = useState(0)
  const [total, setTotal] = useState(0)

  // Load invoice line items
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
      
      const { data: items, error } = await supabase
        .from('invoice_line_items')
        .select('*')
        .eq('invoice_id', invoiceId)
        .eq('tenant_id', tenantId)
        .order('sort_order', { ascending: true })

      if (error) throw error
      setLineItems(items ?? [])
      
      // Calculate totals
      const exGst = (items ?? []).reduce((sum, item) => sum + (item.quantity * item.unit_price), 0)
      const gstAmount = exGst * 0.10
      setSubtotal(exGst)
      setGst(gstAmount)
      setTotal(exGst + gstAmount)
    } catch (error) {
      console.error('Error loading invoice items:', error)
    } finally {
      setLoading(false)
    }
  }, [invoiceId, tenantId])

  useEffect(() => { load() }, [load])

  // Update line item
  const updateItem = useCallback(async (itemId: string, changes: Partial<InvoiceLineItem>) => {
    setLineItems(prev => prev.map(item => {
      if (item.id === itemId) {
        const updated = { ...item, ...changes }
        // Recalculate line total if quantity or unit_price changed
        if ('quantity' in changes || 'unit_price' in changes) {
          updated.line_total = updated.quantity * updated.unit_price
        }
        return updated
      }
      return item
    }))
    setSaveStatus('saving')

    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )

      const updateData: any = { ...changes }
      if ('quantity' in changes || 'unit_price' in changes) {
        const item = lineItems.find(i => i.id === itemId)
        if (item) {
          updateData.line_total = (changes.quantity ?? item.quantity) * (changes.unit_price ?? item.unit_price)
        }
      }

      const { error } = await supabase
        .from('invoice_line_items')
        .update(updateData)
        .eq('id', itemId)
        .eq('tenant_id', tenantId)

      if (error) throw error
      
      // Recalculate totals
      const updatedItems = lineItems.map(item => 
        item.id === itemId ? { ...item, ...changes, line_total: updateData.line_total } : item
      )
      const exGst = updatedItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0)
      const gstAmount = exGst * 0.10
      setSubtotal(exGst)
      setGst(gstAmount)
      setTotal(exGst + gstAmount)
      
      // Update invoice totals
      await supabase
        .from('invoices')
        .update({
          amount_ex_gst: exGst,
          gst: gstAmount,
          amount_inc_gst: exGst + gstAmount,
        })
        .eq('id', invoiceId)
        .eq('tenant_id', tenantId)

      setSaveStatus('saved')
      onInvoiceUpdated?.()
    } catch (error) {
      console.error('Error updating item:', error)
      setSaveStatus('error')
    }
  }, [lineItems, tenantId, invoiceId, onInvoiceUpdated])

  // Add new line item
  const addItem = useCallback(async () => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

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

    if (error) {
      console.error('Error adding item:', error)
      return
    }

    setLineItems(prev => [...prev, newItem])
    onInvoiceUpdated?.()
  }, [lineItems, tenantId, invoiceId, onInvoiceUpdated])

  // Delete line item
  const deleteItem = useCallback(async (itemId: string) => {
    if (!window.confirm('Delete this line item?')) return

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { error } = await supabase
      .from('invoice_line_items')
      .delete()
      .eq('id', itemId)
      .eq('tenant_id', tenantId)

    if (error) {
      console.error('Error deleting item:', error)
      return
    }

    setLineItems(prev => prev.filter(item => item.id !== itemId))
    
    // Recalculate totals
    const updatedItems = lineItems.filter(item => item.id !== itemId)
    const exGst = updatedItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0)
    const gstAmount = exGst * 0.10
    setSubtotal(exGst)
    setGst(gstAmount)
    setTotal(exGst + gstAmount)
    
    // Update invoice totals
    await supabase
      .from('invoices')
      .update({
        amount_ex_gst: exGst,
        gst: gstAmount,
        amount_inc_gst: exGst + gstAmount,
      })
      .eq('id', invoiceId)
      .eq('tenant_id', tenantId)

    onInvoiceUpdated?.()
  }, [lineItems, tenantId, invoiceId, onInvoiceUpdated])

  if (loading) {
    return (
      <div
        style={{
          padding: '40px',
          textAlign: 'center',
          fontFamily: 'DM Sans, sans-serif',
          fontSize: 13,
          color: '#9e998f',
        }}
      >
        Loading invoice…
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'DM Sans, sans-serif' }}>
      {/* Line items */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: '#9e998f', marginBottom: 8 }}>
          Line Items
        </div>
        
        {lineItems.length === 0 ? (
          <div
            style={{
              padding: '20px',
              background: '#f5f2ee',
              borderRadius: 6,
              textAlign: 'center',
              fontSize: 13,
              color: '#9e998f',
            }}
          >
            No line items yet. Add items to build your invoice.
          </div>
        ) : (
          <div style={{ background: '#ffffff', borderRadius: 6, overflow: 'hidden', border: '1px solid #e0dbd4' }}>
            {/* Header */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '3fr 1fr 1fr 1fr 40px',
                gap: 12,
                padding: '12px 16px',
                fontSize: 11,
                fontWeight: 600,
                color: '#9e998f',
                borderBottom: '1px solid #e0dbd4',
                background: '#fafaf8',
              }}
            >
              <div>Description</div>
              <div style={{ textAlign: 'right' }}>Qty</div>
              <div style={{ textAlign: 'right' }}>Unit Price</div>
              <div style={{ textAlign: 'right' }}>Total</div>
              <div />
            </div>
            
            {/* Items */}
            {lineItems.map((item, index) => (
              <div
                key={item.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '3fr 1fr 1fr 1fr 40px',
                  gap: 12,
                  padding: '12px 16px',
                  fontSize: 13,
                  color: '#3a3530',
                  borderBottom: index < lineItems.length - 1 ? '1px solid #e8e0d0' : 'none',
                  alignItems: 'center',
                }}
              >
                <div>
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) => updateItem(item.id, { description: e.target.value })}
                    placeholder="Item description"
                    style={{
                      width: '100%',
                      fontSize: 13,
                      color: '#3a3530',
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      fontFamily: 'DM Sans, sans-serif',
                    }}
                  />
                </div>
                <div style={{ textAlign: 'right' }}>
                  <input
                    type="number"
                    value={item.quantity}
                    onChange={(e) => updateItem(item.id, { quantity: parseFloat(e.target.value) || 0 })}
                    min="0"
                    step="0.01"
                    style={{
                      width: '60px',
                      fontSize: 13,
                      color: '#3a3530',
                      background: '#f5f2ee',
                      border: '1px solid #e0dbd4',
                      borderRadius: 4,
                      padding: '4px 8px',
                      textAlign: 'right',
                      fontFamily: 'DM Sans, sans-serif',
                    }}
                  />
                </div>
                <div style={{ textAlign: 'right' }}>
                  <input
                    type="number"
                    value={item.unit_price}
                    onChange={(e) => updateItem(item.id, { unit_price: parseFloat(e.target.value) || 0 })}
                    min="0"
                    step="0.01"
                    style={{
                      width: '80px',
                      fontSize: 13,
                      color: '#3a3530',
                      background: '#f5f2ee',
                      border: '1px solid #e0dbd4',
                      borderRadius: 4,
                      padding: '4px 8px',
                      textAlign: 'right',
                      fontFamily: 'DM Sans, sans-serif',
                    }}
                  />
                </div>
                <div style={{ textAlign: 'right', fontWeight: 500 }}>
                  {fmt(item.line_total)}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <button
                    onClick={() => deleteItem(item.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#c0bab3',
                      fontSize: 14,
                      padding: '2px',
                      borderRadius: 3,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#c5221f')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = '#c0bab3')}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add item button */}
      <button
        onClick={addItem}
        style={{
          fontFamily: 'DM Sans, sans-serif',
          fontSize: 13,
          color: '#9e998f',
          background: '#ffffff',
          border: '1px solid #e0dbd4',
          borderRadius: 6,
          padding: '8px 16px',
          cursor: 'pointer',
          marginBottom: 20,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = '#c8b89a'
          e.currentTarget.style.color = '#3a3530'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = '#e0dbd4'
          e.currentTarget.style.color = '#9e998f'
        }}
      >
        + Add Line Item
      </button>

      {/* Totals */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e0dbd4',
          borderRadius: 6,
          padding: '16px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: '#9e998f' }}>Subtotal (ex GST)</span>
          <span style={{ fontSize: 13, color: '#3a3530' }}>{fmt(subtotal)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: '#9e998f' }}>GST (10%)</span>
          <span style={{ fontSize: 13, color: '#3a3530' }}>{fmt(gst)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid #e0dbd4' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#3a3530' }}>Total (inc GST)</span>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#3a3530' }}>{fmt(total)}</span>
        </div>
        <div style={{ marginTop: 12, fontSize: 11, color: saveStatus === 'saved' ? '#2e7d32' : saveStatus === 'error' ? '#c5221f' : '#9e998f' }}>
          {saveStatus === 'saved' ? '✓ All changes saved' : saveStatus === 'saving' ? 'Saving...' : saveStatus === 'error' ? 'Error saving changes' : ''}
        </div>
      </div>
    </div>
  )
}
