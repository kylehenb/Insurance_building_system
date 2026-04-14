'use client'

import React, { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'

type InsurerOrder = Database['public']['Tables']['insurer_orders']['Row']
type FilterStatus = 'all' | 'pending' | 'lodged' | 'rejected'
type SortCol = 'date' | 'status' | null
type SortDir = 'asc' | 'desc'
type JobHit = {
  id: string
  job_number: string
  insured_name: string | null
  property_address: string | null
  claim_number: string | null
}

const supabase = createBrowserClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function formatDate(dateString: string | null): string {
  if (!dateString) return '—'
  return new Date(dateString).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function formatCurrency(value: number | null): string {
  if (value == null) return '—'
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value)
}

// Fuzzy: all space-separated tokens must appear somewhere in the row string
function fuzzyMatch(order: InsurerOrder, query: string): boolean {
  if (!query.trim()) return true
  const haystack = [
    order.order_ref, order.claim_number, order.insured_name,
    order.property_address, order.insurer, order.loss_type, order.wo_type,
  ].join(' ').toLowerCase()
  return query.trim().toLowerCase().split(/\s+/).every(t => haystack.includes(t))
}

function WoTypeBadge({ type }: { type: string | null }) {
  const lower = type?.toLowerCase()
  if (lower === 'make safe')
    return <span style={{ background: '#fdecea', color: '#b91c1c', fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 4 }}>Make Safe</span>
  if (lower === 'bar')
    return <span style={{ background: '#e8f0fe', color: '#1a56db', fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 4 }}>BAR</span>
  if (lower === 'roof report')
    return <span style={{ background: '#f0eef8', color: '#4a42a0', fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 4 }}>Roof Report</span>
  if (lower === 'quote only')
    return <span style={{ background: '#fef3c7', color: '#92400e', fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 4 }}>Quote Only</span>
  return <span style={{ background: '#f3f4f6', color: '#6b7280', fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 4 }}>{type ?? 'Other'}</span>
}

function StatusBadge({ status }: { status: string | null }) {
  if (status === 'pending')
    return <span style={{ background: '#fdf5e8', color: '#8a6020', fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 4 }}>Pending</span>
  if (status === 'lodged')
    return <span style={{ background: '#eaf3f0', color: '#2a6b50', fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 4 }}>Lodged</span>
  if (status === 'rejected')
    return <span style={{ background: '#fdecea', color: '#b91c1c', fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 4 }}>Rejected</span>
  return <span style={{ background: '#f3f4f6', color: '#6b7280', fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 4 }}>{status ?? '—'}</span>
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 10 }).map((_, i) => (
        <td key={i} style={{ padding: '12px 12px' }}>
          <div style={{
            height: 13, borderRadius: 4,
            background: 'linear-gradient(90deg, #f0ece6 25%, #e8e3dc 50%, #f0ece6 75%)',
            backgroundSize: '200% 100%',
            animation: 'pulse 1.4s ease-in-out infinite',
            width: i === 3 ? '80%' : '65%',
          }} />
        </td>
      ))}
    </tr>
  )
}

// Read-only field
function F({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 600, color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, color: '#1a1a1a', fontFamily: mono ? "'DM Mono', monospace" : undefined }}>
        {children}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', border: '0.5px solid #e4dfd8', borderRadius: 4,
  padding: '4px 7px', fontSize: 13, fontFamily: "'DM Sans', sans-serif",
  color: '#1a1a1a', background: '#ffffff', boxSizing: 'border-box',
  outline: 'none', transition: 'border-color 0.15s',
}

// Editable text field — saves on blur
function FEdit({
  label, value, onSave, mono, type = 'text',
}: {
  label: string
  value: string | null
  onSave: (val: string) => void
  mono?: boolean
  type?: 'text' | 'date' | 'number' | 'email' | 'tel'
}) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => { setDraft(value ?? '') }, [value])
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 600, color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
        {label}
      </div>
      <input
        type={type}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => onSave(draft)}
        onFocus={e => (e.target.style.borderColor = '#c8b89a')}
        style={{ ...inputStyle, fontFamily: mono ? "'DM Mono', monospace" : "'DM Sans', sans-serif" }}
      />
    </div>
  )
}

// Editable textarea — saves on blur
function FEditArea({ label, value, onSave }: { label: string; value: string | null; onSave: (val: string) => void }) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => { setDraft(value ?? '') }, [value])
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 600, color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
        {label}
      </div>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => onSave(draft)}
        onFocus={e => (e.target.style.borderColor = '#c8b89a')}
        rows={2}
        style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
      />
    </div>
  )
}

// Editable select dropdown for wo_type
function WoTypeSelect({ label, value, onSave }: { label: string; value: string | null; onSave: (val: string) => void }) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => { setDraft(value ?? '') }, [value])
  
  const options = [
    { value: 'BAR', label: 'BAR' },
    { value: 'make_safe', label: 'Make Safe' },
    { value: 'roof_report', label: 'Roof Report' },
    { value: 'specialist', label: 'Specialist' },
    { value: 'variation', label: 'Variation' },
    { value: 'quote_only', label: 'Quote Only' },
  ]
  
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 600, color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
        {label}
      </div>
      <select
        value={draft}
        onChange={e => { setDraft(e.target.value); onSave(e.target.value) }}
        style={{ ...inputStyle, cursor: 'pointer' }}
      >
        <option value="">— Select —</option>
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  )
}

const ghostBtn: React.CSSProperties = {
  border: '1px solid #d4cfc8', borderRadius: 6, padding: '8px 14px', fontSize: 12, fontWeight: 600,
  cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", background: 'transparent', color: '#7a6a58',
}
const greenBtn: React.CSSProperties = {
  border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 12, fontWeight: 600,
  cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", background: '#2a6b50', color: '#ffffff',
}

export default function InsurerOrdersPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<InsurerOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterStatus>('all')
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [newOrderOpen, setNewOrderOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortCol, setSortCol] = useState<SortCol>(null)
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Accordion
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Job number map: jobId → jobNumber
  const [jobNumbers, setJobNumbers] = useState<Record<string, string>>({})

  // Panel-level action state
  const [lodging, setLodging] = useState(false)
  const [lodgeError, setLodgeError] = useState<string | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkResults, setLinkResults] = useState<JobHit[]>([])

  // New order form state
  const [newOrderForm, setNewOrderForm] = useState({
    claim_number: '',
    insurer: '',
    wo_type: '',
    property_address: '',
    insured_name: '',
    insured_phone: '',
    insured_email: '',
    date_of_loss: '',
    loss_type: '',
    claim_description: '',
    special_instructions: '',
  })
  const [creatingOrder, setCreatingOrder] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auth bootstrap
  useEffect(() => {
    async function bootstrap() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: profile, error } = await supabase
        .from('users').select('tenant_id').eq('id', user.id).single()
      if (error || !profile) { router.push('/login'); return }
      setTenantId(profile.tenant_id)
    }
    bootstrap()
  }, [router])

  useEffect(() => {
    if (!tenantId) return
    async function fetchOrders() {
      const { data } = await supabase
        .from('insurer_orders').select('*')
        .eq('tenant_id', tenantId!)
        .order('created_at', { ascending: false })
        .limit(100)
      const rows = data ?? []
      setOrders(rows)
      setLoading(false)

      const jobIds = [...new Set(rows.filter(o => o.job_id).map(o => o.job_id as string))]
      if (jobIds.length > 0) {
        const { data: jobs } = await supabase.from('jobs').select('id, job_number').in('id', jobIds)
        if (jobs) {
          const map: Record<string, string> = {}
          jobs.forEach((j: { id: string; job_number: string }) => { map[j.id] = j.job_number })
          setJobNumbers(map)
        }
      }
    }
    fetchOrders()
  }, [tenantId])

  // Debounced link-job search
  useEffect(() => {
    if (!linkSearch.trim() || !tenantId) { setLinkResults([]); return }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    const term = linkSearch.trim()
    searchTimer.current = setTimeout(async () => {
      const { data } = await supabase
        .from('jobs').select('id, job_number, insured_name, property_address, claim_number')
        .eq('tenant_id', tenantId)
        .or(`job_number.ilike.%${term}%,claim_number.ilike.%${term}%`)
        .limit(5)
      setLinkResults((data as JobHit[]) ?? [])
    }, 300)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [linkSearch, tenantId])

  function openAccordion(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
    } else {
      setExpandedId(id)
      setLodging(false); setLodgeError(null)
      setRejectOpen(false); setRejectReason('')
      setLinkOpen(false); setLinkSearch(''); setLinkResults([])
    }
  }

  function toggleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('desc')
    }
  }

  // Save a text field on blur
  async function saveField(orderId: string, field: keyof InsurerOrder, raw: string) {
    const value = raw.trim() || null
    await supabase.from('insurer_orders').update({ [field]: value } as never).eq('id', orderId)
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, [field]: value } : o))
  }

  // Save a numeric field on blur
  async function saveNumberField(orderId: string, field: keyof InsurerOrder, raw: string) {
    const value = raw.trim() ? parseFloat(raw.trim()) : null
    await supabase.from('insurer_orders').update({ [field]: value } as never).eq('id', orderId)
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, [field]: value } : o))
  }

  async function handleLodge(order: InsurerOrder) {
    setLodging(true); setLodgeError(null)
    try {
      const res = await fetch('/api/insurer-orders/lodge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id }),
      })
      const json = await res.json()
      if (!res.ok) { setLodgeError(json.error ?? 'Lodge failed'); setLodging(false); return }
      const { jobNumber, jobId } = json as { jobNumber: string; jobId: string }
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, job_id: jobId, status: 'lodged' } : o))
      setJobNumbers(prev => ({ ...prev, [jobId]: jobNumber }))
    } catch { setLodgeError('Network error — please try again') }
    setLodging(false)
  }

  async function handleReject(order: InsurerOrder) {
    const updatedNotes = order.notes
      ? `${order.notes}\n\nRejected: ${rejectReason}`
      : `Rejected: ${rejectReason}`
    const { error } = await supabase.from('insurer_orders')
      .update({ status: 'rejected', notes: updatedNotes }).eq('id', order.id)
    if (!error) {
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'rejected', notes: updatedNotes } : o))
      setRejectOpen(false); setRejectReason('')
    }
  }

  async function handleLinkJob(order: InsurerOrder, job: JobHit) {
    const { error } = await supabase.from('insurer_orders')
      .update({ job_id: job.id, status: 'lodged' }).eq('id', order.id)
    if (!error) {
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, job_id: job.id, status: 'lodged' } : o))
      setJobNumbers(prev => ({ ...prev, [job.id]: job.job_number }))
      setLinkOpen(false); setLinkSearch(''); setLinkResults([])
    }
  }

  async function handleCreateOrder() {
    if (!tenantId) return
    if (!newOrderForm.claim_number.trim()) {
      setCreateError('Claim number is required')
      return
    }

    setCreatingOrder(true)
    setCreateError(null)

    try {
      const { data: newOrder, error } = await supabase
        .from('insurer_orders')
        .insert({
          tenant_id: tenantId,
          claim_number: newOrderForm.claim_number.trim(),
          insurer: newOrderForm.insurer.trim() || null,
          wo_type: newOrderForm.wo_type || null,
          property_address: newOrderForm.property_address.trim() || null,
          insured_name: newOrderForm.insured_name.trim() || null,
          insured_phone: newOrderForm.insured_phone.trim() || null,
          insured_email: newOrderForm.insured_email.trim() || null,
          date_of_loss: newOrderForm.date_of_loss || null,
          loss_type: newOrderForm.loss_type.trim() || null,
          claim_description: newOrderForm.claim_description.trim() || null,
          special_instructions: newOrderForm.special_instructions.trim() || null,
          entry_method: 'manual',
          parse_status: 'manual_entry',
          status: 'pending',
        })
        .select()
        .single()

      if (error) throw error

      setOrders(prev => [newOrder, ...prev])
      setNewOrderOpen(false)
      setNewOrderForm({
        claim_number: '',
        insurer: '',
        wo_type: '',
        property_address: '',
        insured_name: '',
        insured_phone: '',
        insured_email: '',
        date_of_loss: '',
        loss_type: '',
        claim_description: '',
        special_instructions: '',
      })
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create order')
    } finally {
      setCreatingOrder(false)
    }
  }

  // Filter → fuzzy search → sort
  let visible = filter === 'all' ? orders : orders.filter(o => o.status === filter)
  visible = visible.filter(o => fuzzyMatch(o, searchQuery))
  if (sortCol === 'date') {
    visible = [...visible].sort((a, b) => {
      const av = a.date_of_loss ?? ''
      const bv = b.date_of_loss ?? ''
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
  } else if (sortCol === 'status') {
    const order = ['pending', 'lodged', 'rejected']
    visible = [...visible].sort((a, b) => {
      const av = order.indexOf(a.status ?? '')
      const bv = order.indexOf(b.status ?? '')
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }

  const totalCount = orders.length
  const pendingCount = orders.filter(o => o.status === 'pending').length
  const makeSafeCount = orders.filter(o => o.is_make_safe === true).length

  const pillBase: React.CSSProperties = {
    fontSize: 12, fontWeight: 500, padding: '5px 14px', borderRadius: 20,
    cursor: 'pointer', border: 'none', transition: 'background 0.15s, color 0.15s',
    fontFamily: "'DM Sans', sans-serif",
  }
  const pillActive: React.CSSProperties = { ...pillBase, background: '#1a1a1a', color: '#c8b89a' }
  const pillInactive: React.CSSProperties = { ...pillBase, background: 'transparent', color: '#9a9088', border: '1px solid #e0dbd4' }

  function SortIndicator({ col }: { col: SortCol }) {
    if (sortCol !== col) return <span style={{ marginLeft: 4, color: '#d4cfc8', fontSize: 9 }}>⇅</span>
    return <span style={{ marginLeft: 4, color: '#c8b89a', fontSize: 9 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
  }

  const thStyle: React.CSSProperties = {
    padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600,
    color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.05em',
    whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdfdfc', zIndex: 1,
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f2ee', fontFamily: "'DM Sans', sans-serif", color: '#3a3530' }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { background-position: 200% 0; }
          50% { background-position: -200% 0; }
        }
        .order-row:hover td { background: #faf9f7 !important; }
        .order-row { cursor: pointer; }
        .chevron { display: inline-block; transition: transform 0.2s; font-size: 10px; color: #b0a898; }
        .chevron.open { transform: rotate(90deg); }
        .sort-th { cursor: pointer; user-select: none; }
        .sort-th:hover { color: #7a6a58 !important; }
        .fedit-input:focus { border-color: #c8b89a !important; outline: none; }
      `}</style>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '36px 28px 60px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Insurer Orders</h1>
            <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
              {(['all', 'pending', 'lodged', 'rejected'] as FilterStatus[]).map(f => (
                <button key={f} style={filter === f ? pillActive : pillInactive} onClick={() => setFilter(f)}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => setNewOrderOpen(true)}
            style={{
              background: '#1a1a1a', color: '#f5f2ee', border: 'none', borderRadius: 8,
              padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              fontFamily: "'DM Sans', sans-serif", marginTop: 4,
            }}
          >
            New Order
          </button>
        </div>

        {/* Stat cards */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Total Orders', value: totalCount },
            { label: 'Pending', value: pendingCount },
            { label: 'Make Safes', value: makeSafeCount },
          ].map(card => (
            <div key={card.label} style={{
              background: '#ffffff', border: '0.5px solid #e4dfd8', borderRadius: 8,
              padding: '14px 20px', borderLeft: '3px solid #c8b89a', minWidth: 120,
            }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#1a1a1a', lineHeight: 1 }}>
                {loading ? '—' : card.value}
              </div>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 5 }}>
                {card.label}
              </div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ position: 'relative', maxWidth: 360 }}>
            <svg
              viewBox="0 0 20 20" fill="none" stroke="#b0a898" strokeWidth="1.6"
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, pointerEvents: 'none' }}
            >
              <circle cx="8.5" cy="8.5" r="5.5" /><line x1="13" y1="13" x2="17" y2="17" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search orders…"
              style={{
                width: '100%', border: '0.5px solid #e4dfd8', borderRadius: 6,
                padding: '9px 12px 9px 32px', fontSize: 13,
                fontFamily: "'DM Sans', sans-serif", color: '#3a3530',
                background: '#ffffff', boxSizing: 'border-box', outline: 'none',
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#b0a898', fontSize: 14, padding: 0, lineHeight: 1 }}
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div style={{ background: '#ffffff', border: '0.5px solid #e4dfd8', borderRadius: 8, overflow: 'clip' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 96 }} />
                <col style={{ width: 112 }} />
                <col style={{ width: 118 }} />
                <col style={{ width: 158 }} />
                <col style={{ width: 94 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 82 }} />
                <col style={{ width: 58 }} />
                <col style={{ width: 28 }} />
              </colgroup>
              <thead>
                <tr style={{ background: '#fdfdfc', borderBottom: '0.5px solid #e4dfd8' }}>
                  <th style={thStyle}>Order Ref</th>
                  <th style={thStyle}>Claim #</th>
                  <th style={thStyle}>Insured</th>
                  <th style={thStyle}>Address</th>
                  <th style={thStyle}>Insurer</th>
                  <th style={thStyle}>Type</th>
                  <th
                    className="sort-th"
                    style={thStyle}
                    onClick={() => toggleSort('date')}
                  >
                    Date<SortIndicator col="date" />
                  </th>
                  <th
                    className="sort-th"
                    style={thStyle}
                    onClick={() => toggleSort('status')}
                  >
                    Status<SortIndicator col="status" />
                  </th>
                  <th style={thStyle}>Job</th>
                  <th style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                ) : visible.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ padding: '48px 16px', textAlign: 'center', color: '#b0a898', fontSize: 13 }}>
                      {searchQuery ? 'No orders match your search' : 'No orders found'}
                    </td>
                  </tr>
                ) : (
                  visible.map(order => {
                    const isOpen = expandedId === order.id
                    const isLinked = !!order.job_id
                    const jobNum = order.job_id ? jobNumbers[order.job_id] : undefined
                    const rowBg = isOpen ? '#fdf9f4' : undefined
                    const leftBorder = isOpen ? '2.5px solid #c8b89a' : '2.5px solid transparent'

                    return (
                      <React.Fragment key={order.id}>
                        <tr
                          className="order-row"
                          onClick={() => openAccordion(order.id)}
                          style={{ borderBottom: isOpen ? 'none' : '0.5px solid #f0ece6' }}
                        >
                          <td style={{ padding: '12px 12px', whiteSpace: 'nowrap', overflow: 'hidden', background: rowBg, borderLeft: leftBorder }}>
                            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#c8b89a', fontWeight: 500 }}>
                              {order.order_ref ?? order.id.slice(-8)}
                            </span>
                          </td>
                          <td style={{ padding: '12px 12px', overflow: 'hidden', background: rowBg }}>
                            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {order.claim_number}
                            </span>
                          </td>
                          <td style={{ padding: '12px 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: rowBg }}>
                            {order.insured_name ?? '—'}
                          </td>
                          <td style={{ padding: '12px 12px', overflow: 'hidden', background: rowBg }}>
                            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {order.property_address ?? '—'}
                            </span>
                          </td>
                          <td style={{ padding: '12px 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: rowBg }}>
                            {order.insurer ?? '—'}
                          </td>
                          <td style={{ padding: '12px 12px', whiteSpace: 'nowrap', overflow: 'hidden', background: rowBg }}>
                            <WoTypeBadge type={order.wo_type} />
                          </td>
                          <td style={{ padding: '12px 12px', whiteSpace: 'nowrap', fontSize: 12, color: '#b0a898', background: rowBg }}>
                            {formatDate(order.date_of_loss)}
                          </td>
                          <td style={{ padding: '12px 12px', whiteSpace: 'nowrap', background: rowBg }}>
                            <StatusBadge status={order.status} />
                          </td>
                          <td style={{ padding: '12px 12px', background: rowBg }}>
                            {order.job_id ? (
                              <button
                                onClick={e => { e.stopPropagation(); router.push(`/dashboard/jobs/${order.job_id}`) }}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#c8b89a', display: 'flex', alignItems: 'center' }}
                                title={jobNum ?? 'View linked job'}
                              >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                </svg>
                              </button>
                            ) : (
                              <span style={{ color: '#b0a898' }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: '12px 8px', textAlign: 'center', background: rowBg }}>
                            <span className={`chevron${isOpen ? ' open' : ''}`}>▸</span>
                          </td>
                        </tr>

                        {/* Expanded panel */}
                        {isOpen && (
                          <tr>
                            <td colSpan={10} style={{ padding: 0, borderBottom: '0.5px solid #e4dfd8' }}>
                              <div style={{
                                background: isLinked ? '#f0fbf5' : '#fdfcfb',
                                borderTop: isLinked ? '2px solid #b8e0c8' : '0.5px solid #f0ece6',
                                padding: '14px 20px',
                              }}>

                                {/* Linked banner */}
                                {isLinked && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, padding: '8px 12px', background: '#e6f4ed', border: '1px solid #6aad8a', borderRadius: 6 }}>
                                    <span style={{ background: '#e6f4ed', color: '#1e5e3c', fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 20, border: '1px solid #6aad8a', whiteSpace: 'nowrap' }}>
                                      Already linked to {jobNum ?? order.job_id!.slice(-8)}
                                    </span>
                                    <button
                                      onClick={() => router.push(`/dashboard/jobs/${order.job_id}`)}
                                      style={{ ...ghostBtn, border: '1px solid #6aad8a', color: '#1e5e3c' }}
                                    >
                                      Open Job →
                                    </button>
                                  </div>
                                )}

                                {/* Two-column editable grid */}
                                <div style={{ display: 'grid', gridTemplateColumns: '55% 45%', gap: 16, marginBottom: 12 }}>

                                  {/* Left column */}
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px' }}>
                                    <F label="Order Ref" mono>{order.order_ref ?? '—'}</F>
                                    <FEdit
                                      label="Insurer" value={order.insurer}
                                      onSave={v => saveField(order.id, 'insurer', v)}
                                    />
                                    <WoTypeSelect
                                      label="WO Type" value={order.wo_type}
                                      onSave={v => saveField(order.id, 'wo_type', v)}
                                    />
                                    <FEdit
                                      label="Date of Loss" value={order.date_of_loss?.slice(0, 10) ?? ''}
                                      type="date"
                                      onSave={v => saveField(order.id, 'date_of_loss', v)}
                                    />
                                    <F label="Date Created">{formatDate(order.created_at)}</F>
                                    <FEdit
                                      label="Sum Insured"
                                      value={order.sum_insured_building != null ? String(order.sum_insured_building) : ''}
                                      type="number"
                                      onSave={v => saveNumberField(order.id, 'sum_insured_building', v)}
                                    />
                                    <div style={{ gridColumn: '1 / -1' }}>
                                      <FEdit
                                        label="Property Address" value={order.property_address}
                                        onSave={v => saveField(order.id, 'property_address', v)}
                                      />
                                    </div>
                                    <FEdit
                                      label="Excess"
                                      value={order.excess_building != null ? String(order.excess_building) : ''}
                                      type="number"
                                      onSave={v => saveNumberField(order.id, 'excess_building', v)}
                                    />
                                  </div>

                                  {/* Right column */}
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px' }}>
                                    <FEdit
                                      label="Claim Number" value={order.claim_number} mono
                                      onSave={v => saveField(order.id, 'claim_number', v)}
                                    />
                                    <FEdit
                                      label="Adjuster" value={order.adjuster}
                                      onSave={v => saveField(order.id, 'adjuster', v)}
                                    />
                                    <FEdit
                                      label="Insured Name" value={order.insured_name}
                                      onSave={v => saveField(order.id, 'insured_name', v)}
                                    />
                                    <FEdit
                                      label="Loss Type" value={order.loss_type}
                                      onSave={v => saveField(order.id, 'loss_type', v)}
                                    />
                                    <FEdit
                                      label="Phone" value={order.insured_phone} type="tel"
                                      onSave={v => saveField(order.id, 'insured_phone', v)}
                                    />
                                    <FEdit
                                      label="Email" value={order.insured_email} type="email"
                                      onSave={v => saveField(order.id, 'insured_email', v)}
                                    />
                                    <F label="Entry Method">{order.entry_method ?? '—'}</F>
                                    {order.parse_status && <F label="Parse Status">{order.parse_status}</F>}
                                  </div>
                                </div>

                                {/* Full-width editable text sections */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                                  <FEditArea
                                    label="Claim Description" value={order.claim_description}
                                    onSave={v => saveField(order.id, 'claim_description', v)}
                                  />
                                  <FEditArea
                                    label="Special Instructions" value={order.special_instructions}
                                    onSave={v => saveField(order.id, 'special_instructions', v)}
                                  />
                                  <FEditArea
                                    label="Notes" value={order.notes}
                                    onSave={v => saveField(order.id, 'notes', v)}
                                  />
                                </div>

                                {/* Action buttons */}
                                <div style={{ marginTop: 10 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    {isLinked ? (
                                      order.status === 'rejected' ? (
                                        <span style={{ background: '#fdecea', color: '#b91c1c', fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 20 }}>✗ Rejected</span>
                                      ) : order.status === 'lodged' ? (
                                        <>
                                          <span style={{ background: '#eaf3f0', color: '#2a6b50', fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 20 }}>
                                            ✓ Lodged as {jobNum ?? '…'}
                                          </span>
                                          <button onClick={() => router.push(`/dashboard/jobs/${order.job_id}`)} style={ghostBtn}>Open Job →</button>
                                        </>
                                      ) : (
                                        <button onClick={() => setRejectOpen(v => !v)} style={{ ...ghostBtn, color: '#b91c1c' }}>Reject</button>
                                      )
                                    ) : order.status === 'rejected' ? (
                                      <span style={{ background: '#fdecea', color: '#b91c1c', fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 20 }}>✗ Rejected</span>
                                    ) : (
                                      <>
                                        <button
                                          onClick={() => handleLodge(order)}
                                          disabled={lodging}
                                          style={{ ...greenBtn, opacity: lodging ? 0.7 : 1 }}
                                        >
                                          {lodging ? 'Lodging…' : 'Lodge Order'}
                                        </button>
                                        <button onClick={() => setRejectOpen(v => !v)} disabled={lodging} style={{ ...ghostBtn, color: '#b91c1c', opacity: lodging ? 0.5 : 1 }}>Reject</button>
                                        <button onClick={() => setLinkOpen(v => !v)} disabled={lodging} style={{ ...ghostBtn, opacity: lodging ? 0.5 : 1 }}>Link to existing job</button>
                                      </>
                                    )}
                                  </div>

                                  {lodgeError && (
                                    <div style={{ marginTop: 8, fontSize: 12, color: '#b91c1c' }}>{lodgeError}</div>
                                  )}

                                  {/* Reject inline form */}
                                  {rejectOpen && order.status !== 'rejected' && (
                                    <div style={{ marginTop: 12, padding: '14px 16px', background: '#fdfcfb', border: '0.5px solid #e4dfd8', borderRadius: 6 }}>
                                      <div style={{ fontSize: 12, fontWeight: 600, color: '#3a3530', marginBottom: 8 }}>Reason for rejection</div>
                                      <textarea
                                        value={rejectReason}
                                        onChange={e => setRejectReason(e.target.value)}
                                        rows={2}
                                        placeholder="Optional reason…"
                                        style={{
                                          width: '100%', border: '0.5px solid #e4dfd8', borderRadius: 4,
                                          padding: '8px 10px', fontSize: 13, fontFamily: "'DM Sans', sans-serif",
                                          color: '#3a3530', resize: 'vertical', boxSizing: 'border-box',
                                        }}
                                      />
                                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                        <button onClick={() => handleReject(order)} style={greenBtn}>Confirm Reject</button>
                                        <button onClick={() => { setRejectOpen(false); setRejectReason('') }} style={ghostBtn}>Cancel</button>
                                      </div>
                                    </div>
                                  )}

                                  {/* Link to existing job */}
                                  {linkOpen && !isLinked && (
                                    <div style={{ marginTop: 12, padding: '14px 16px', background: '#fdfcfb', border: '0.5px solid #e4dfd8', borderRadius: 6 }}>
                                      <div style={{ fontSize: 12, fontWeight: 600, color: '#3a3530', marginBottom: 8 }}>Search by job number or claim number</div>
                                      <input
                                        type="text"
                                        value={linkSearch}
                                        onChange={e => setLinkSearch(e.target.value)}
                                        placeholder="e.g. IRC1008 or CLM-12345"
                                        style={{
                                          width: '100%', border: '0.5px solid #e4dfd8', borderRadius: 4,
                                          padding: '8px 10px', fontSize: 13, fontFamily: "'DM Sans', sans-serif",
                                          color: '#3a3530', boxSizing: 'border-box',
                                        }}
                                      />
                                      {linkResults.length > 0 && (
                                        <div style={{ marginTop: 6, border: '0.5px solid #e4dfd8', borderRadius: 4, overflow: 'hidden' }}>
                                          {linkResults.map(job => (
                                            <button
                                              key={job.id}
                                              onClick={() => handleLinkJob(order, job)}
                                              style={{
                                                display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                                                padding: '10px 12px', background: 'none', border: 'none',
                                                borderBottom: '0.5px solid #f0ece6', cursor: 'pointer',
                                                textAlign: 'left', fontFamily: "'DM Sans', sans-serif",
                                              }}
                                            >
                                              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: '#c8b89a', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                                {job.job_number}
                                              </span>
                                              <span style={{ fontSize: 13, color: '#3a3530' }}>{job.insured_name ?? '—'}</span>
                                              <span style={{ fontSize: 12, color: '#b0a898', marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                                                {job.property_address ?? ''}
                                              </span>
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* New Order panel */}
      {newOrderOpen && (
        <>
          <div
            onClick={() => setNewOrderOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 40 }}
          />
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: 480,
            background: '#ffffff', borderLeft: '1px solid #e4dfd8', zIndex: 50,
            padding: '36px 32px', fontFamily: "'DM Sans', sans-serif",
            boxShadow: '-4px 0 24px rgba(0,0,0,0.08)', overflowY: 'auto',
          }}>
            <div style={{ fontSize: 12, color: '#b0a898', marginBottom: 8 }}>New Order</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a', marginBottom: 24 }}>Create Insurer Order</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  Claim Number *
                </div>
                <input
                  type="text"
                  value={newOrderForm.claim_number}
                  onChange={e => setNewOrderForm(f => ({ ...f, claim_number: e.target.value }))}
                  placeholder="Required"
                  style={{ ...inputStyle, borderColor: !newOrderForm.claim_number.trim() && createError ? '#b91c1c' : undefined }}
                />
              </div>

              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  Insurer
                </div>
                <input
                  type="text"
                  value={newOrderForm.insurer}
                  onChange={e => setNewOrderForm(f => ({ ...f, insurer: e.target.value }))}
                  placeholder="e.g. Allianz, Suncorp"
                  style={inputStyle}
                />
              </div>

              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  Work Order Type
                </div>
                <select
                  value={newOrderForm.wo_type}
                  onChange={e => setNewOrderForm(f => ({ ...f, wo_type: e.target.value }))}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  <option value="">— Select —</option>
                  <option value="BAR">BAR</option>
                  <option value="make_safe">Make Safe</option>
                  <option value="roof_report">Roof Report</option>
                  <option value="specialist">Specialist</option>
                  <option value="variation">Variation</option>
                  <option value="quote_only">Quote Only</option>
                </select>
              </div>

              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  Property Address
                </div>
                <input
                  type="text"
                  value={newOrderForm.property_address}
                  onChange={e => setNewOrderForm(f => ({ ...f, property_address: e.target.value }))}
                  placeholder="Street address"
                  style={inputStyle}
                />
              </div>

              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  Insured Name
                </div>
                <input
                  type="text"
                  value={newOrderForm.insured_name}
                  onChange={e => setNewOrderForm(f => ({ ...f, insured_name: e.target.value }))}
                  placeholder="Full name"
                  style={inputStyle}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                    Phone
                  </div>
                  <input
                    type="tel"
                    value={newOrderForm.insured_phone}
                    onChange={e => setNewOrderForm(f => ({ ...f, insured_phone: e.target.value }))}
                    placeholder="04xx xxx xxx"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                    Email
                  </div>
                  <input
                    type="email"
                    value={newOrderForm.insured_email}
                    onChange={e => setNewOrderForm(f => ({ ...f, insured_email: e.target.value }))}
                    placeholder="email@example.com"
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                    Date of Loss
                  </div>
                  <input
                    type="date"
                    value={newOrderForm.date_of_loss}
                    onChange={e => setNewOrderForm(f => ({ ...f, date_of_loss: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                    Loss Type
                  </div>
                  <input
                    type="text"
                    value={newOrderForm.loss_type}
                    onChange={e => setNewOrderForm(f => ({ ...f, loss_type: e.target.value }))}
                    placeholder="e.g. Storm, Fire, Water"
                    style={inputStyle}
                  />
                </div>
              </div>

              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  Claim Description
                </div>
                <textarea
                  value={newOrderForm.claim_description}
                  onChange={e => setNewOrderForm(f => ({ ...f, claim_description: e.target.value }))}
                  rows={3}
                  placeholder="Brief description of the claim..."
                  style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
                />
              </div>

              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  Special Instructions
                </div>
                <textarea
                  value={newOrderForm.special_instructions}
                  onChange={e => setNewOrderForm(f => ({ ...f, special_instructions: e.target.value }))}
                  rows={2}
                  placeholder="Any special instructions..."
                  style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
                />
              </div>

              {createError && (
                <div style={{ fontSize: 12, color: '#b91c1c', padding: '8px 12px', background: '#fdecea', borderRadius: 4 }}>
                  {createError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button
                  onClick={handleCreateOrder}
                  disabled={creatingOrder || !newOrderForm.claim_number.trim()}
                  style={{
                    flex: 1,
                    background: '#1a1a1a', color: '#f5f2ee', border: 'none', borderRadius: 8,
                    padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    fontFamily: "'DM Sans', sans-serif", opacity: (creatingOrder || !newOrderForm.claim_number.trim()) ? 0.5 : 1,
                  }}
                >
                  {creatingOrder ? 'Creating…' : 'Create Order'}
                </button>
                <button
                  onClick={() => {
                    setNewOrderOpen(false)
                    setNewOrderForm({
                      claim_number: '',
                      insurer: '',
                      wo_type: '',
                      property_address: '',
                      insured_name: '',
                      insured_phone: '',
                      insured_email: '',
                      date_of_loss: '',
                      loss_type: '',
                      claim_description: '',
                      special_instructions: '',
                    })
                    setCreateError(null)
                  }}
                  style={{ ...ghostBtn, flex: 1 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
