'use client'

import React, { useEffect, useRef, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { AccordionList } from './shared/AccordionList'
import { AccordionRow } from './shared/AccordionRow'

// — Types ——————————————————————————————————————————————————————————
interface InsurerOrder {
  id: string
  tenant_id: string
  job_id: string | null
  order_ref: string | null
  wo_type: string | null
  insurer: string | null
  status: string | null
  notes: string | null
  created_at: string | null
}

interface InsurerOrdersTabProps {
  jobId: string
  tenantId: string
}

// — Status pill ————————————————————————————————————————————————————
const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  pending:   { bg: '#fff8e1', text: '#b45309' },
  received:  { bg: '#e8f0fe', text: '#1a73e8' },
  actioned:  { bg: '#e8f5e9', text: '#2e7d32' },
  closed:    { bg: '#f5f2ee', text: '#9e998f' },
}

function StatusPill({ status }: { status: string | null }) {
  const key = (status ?? '').toLowerCase()
  const s = STATUS_STYLES[key] ?? { bg: '#f5f2ee', text: '#9e998f' }
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize"
      style={{ background: s.bg, color: s.text }}
    >
      {status ?? '—'}
    </span>
  )
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

const inputStyle: React.CSSProperties = {
  fontFamily: 'DM Sans, sans-serif',
  fontSize: 13,
  background: '#fff',
  border: '1px solid #e0dbd4',
  borderRadius: 6,
  padding: '7px 10px',
  width: '100%',
  outline: 'none',
  color: '#3a3530',
}

const labelStyle: React.CSSProperties = {
  fontFamily: 'DM Sans, sans-serif',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  color: '#9e998f',
  display: 'block',
  marginBottom: 5,
}

// — Order form ——————————————————————————————————————————————————
function OrderForm({
  order,
  tenantId,
  onSave,
  onDelete,
}: {
  order: InsurerOrder
  tenantId: string
  onSave: (id: string, changes: Partial<InsurerOrder>) => void
  onDelete: (id: string) => void
}) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [receivedDate, setReceivedDate] = useState(
    order.created_at ? order.created_at.slice(0, 10) : ''
  )
  const [channel, setChannel] = useState('')
  const [notes, setNotes] = useState(order.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Store channel in notes prefix pattern — simple approach
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  function scheduleNoteSave(value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSaved(false)
    setSaving(true)
    debounceRef.current = setTimeout(async () => {
      await supabase
        .from('insurer_orders')
        .update({ notes: value || null })
        .eq('id', order.id)
        .eq('tenant_id', tenantId)
      setSaving(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }, 1500)
  }

  async function handleSave() {
    setSaving(true)
    const { error } = await supabase
      .from('insurer_orders')
      .update({ notes: notes || null })
      .eq('id', order.id)
      .eq('tenant_id', tenantId)
    setSaving(false)
    if (!error) {
      setSaved(true)
      onSave(order.id, { notes })
      setTimeout(() => setSaved(false), 2000)
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this insurer order?')) return
    setDeleting(true)
    await supabase
      .from('insurer_orders')
      .delete()
      .eq('id', order.id)
      .eq('tenant_id', tenantId)
    onDelete(order.id)
  }

  return (
    <div style={{ fontFamily: 'DM Sans, sans-serif' }}>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label style={labelStyle}>Received Date</label>
          <input
            type="date"
            value={receivedDate}
            style={inputStyle}
            readOnly
            onChange={e => setReceivedDate(e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle}>Channel</label>
          <select
            value={channel}
            style={inputStyle}
            onChange={e => setChannel(e.target.value)}
            onFocus={e => (e.currentTarget.style.borderColor = '#c8b89a')}
            onBlur={e => (e.currentTarget.style.borderColor = '#e0dbd4')}
          >
            <option value="">Select…</option>
            <option value="Email">Email</option>
            <option value="Phone">Phone</option>
            <option value="Portal">Portal</option>
          </select>
        </div>
      </div>

      <div className="mb-4">
        <label style={labelStyle}>Order Notes</label>
        <textarea
          value={notes}
          rows={4}
          style={{ ...inputStyle, resize: 'vertical' }}
          onChange={e => {
            setNotes(e.target.value)
            scheduleNoteSave(e.target.value)
          }}
          onFocus={e => (e.currentTarget.style.borderColor = '#c8b89a')}
          onBlur={e => (e.currentTarget.style.borderColor = '#e0dbd4')}
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[#9e998f]">
          {saving ? 'Saving…' : saved ? 'Saved' : ''}
        </span>
        <div className="flex items-center gap-4">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-[12px] text-red-500 hover:text-red-700 transition-colors"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 rounded text-[12px] font-medium text-white transition-colors"
            style={{ background: '#3a3530' }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// — InsurerOrdersTab ——————————————————————————————————————————————
export function InsurerOrdersTab({ jobId, tenantId }: InsurerOrdersTabProps) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [orders, setOrders] = useState<InsurerOrder[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('insurer_orders')
        .select('id,tenant_id,job_id,order_ref,wo_type,insurer,status,notes,created_at')
        .eq('job_id', jobId)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true })
      setOrders((data ?? []) as InsurerOrder[])
      setLoading(false)
    }
    load()
  }, [jobId, tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSave(id: string, changes: Partial<InsurerOrder>) {
    setOrders(prev => prev.map(o => (o.id === id ? { ...o, ...changes } : o)))
  }

  function handleDelete(id: string) {
    setOrders(prev => prev.filter(o => o.id !== id))
  }

  if (loading) {
    return <div className="py-12 text-center text-[13px] text-[#9e998f]">Loading…</div>
  }

  return (
    <AccordionList title="Insurer Orders">
      {orders.length === 0 ? (
        <div className="px-4 py-8 text-center text-[13px] text-[#9e998f]">
          No insurer orders linked to this job
        </div>
      ) : (
        orders.map(order => (
          <AccordionRow
            key={order.id}
            summary={
              <div className="flex items-center gap-3 flex-wrap">
                <span
                  className="text-[13px] font-medium"
                  style={{ fontFamily: 'DM Mono, monospace', color: '#c8b89a' }}
                >
                  {order.order_ref ?? '—'}
                </span>
                {order.wo_type && (
                  <span className="text-[13px] text-[#3a3530]">{order.wo_type}</span>
                )}
                {order.insurer && (
                  <span className="text-[12px] text-[#9e998f]">{order.insurer}</span>
                )}
                <span className="text-[12px] text-[#9e998f]">{formatDate(order.created_at)}</span>
                <StatusPill status={order.status} />
              </div>
            }
          >
            <OrderForm
              order={order}
              tenantId={tenantId}
              onSave={handleSave}
              onDelete={handleDelete}
            />
          </AccordionRow>
        ))
      )}
    </AccordionList>
  )
}
