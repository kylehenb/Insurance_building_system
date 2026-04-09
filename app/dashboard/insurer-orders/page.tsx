'use client'

import React, { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'

type InsurerOrder = Database['public']['Tables']['insurer_orders']['Row']
type FilterStatus = 'all' | 'pending' | 'lodged' | 'rejected'
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
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatCurrency(value: number | null): string {
  if (value == null) return '—'
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value)
}

function WoTypeBadge({ type }: { type: string | null }) {
  const lower = type?.toLowerCase()
  if (lower === 'make safe')
    return <span style={{ background: '#fdecea', color: '#b91c1c', fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4 }}>Make Safe</span>
  if (lower === 'bar')
    return <span style={{ background: '#e8f0fe', color: '#1a56db', fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4 }}>BAR</span>
  if (lower === 'roof report')
    return <span style={{ background: '#f0eef8', color: '#4a42a0', fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4 }}>Roof Report</span>
  return <span style={{ background: '#f3f4f6', color: '#6b7280', fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4 }}>{type ?? 'Other'}</span>
}

function StatusBadge({ status }: { status: string | null }) {
  if (status === 'pending')
    return <span style={{ background: '#fdf5e8', color: '#8a6020', fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4 }}>Pending</span>
  if (status === 'lodged')
    return <span style={{ background: '#eaf3f0', color: '#2a6b50', fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4 }}>Lodged</span>
  if (status === 'rejected')
    return <span style={{ background: '#fdecea', color: '#b91c1c', fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4 }}>Rejected</span>
  return <span style={{ background: '#f3f4f6', color: '#6b7280', fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4 }}>{status ?? '—'}</span>
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 11 }).map((_, i) => (
        <td key={i} style={{ padding: '14px 16px' }}>
          <div style={{
            height: 14, borderRadius: 4,
            background: 'linear-gradient(90deg, #f0ece6 25%, #e8e3dc 50%, #f0ece6 75%)',
            backgroundSize: '200% 100%',
            animation: 'pulse 1.4s ease-in-out infinite',
            width: i === 3 ? '80%' : '70%',
          }} />
        </td>
      ))}
    </tr>
  )
}

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

  // Accordion
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Job number map: jobId → jobNumber
  const [jobNumbers, setJobNumbers] = useState<Record<string, string>>({})

  // Panel-level state (single expanded at a time)
  const [lodging, setLodging] = useState(false)
  const [lodgeError, setLodgeError] = useState<string | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkResults, setLinkResults] = useState<JobHit[]>([])
  const [editToast, setEditToast] = useState(false)

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auth bootstrap
  useEffect(() => {
    async function bootstrap() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: profile, error } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('id', user.id)
        .single()
      if (error || !profile) { router.push('/login'); return }
      setTenantId(profile.tenant_id)
    }
    bootstrap()
  }, [router])

  useEffect(() => {
    if (!tenantId) return
    async function fetchOrders() {
      const { data } = await supabase
        .from('insurer_orders')
        .select('*')
        .eq('tenant_id', tenantId!)
        .order('created_at', { ascending: false })
        .limit(100)
      const rows = data ?? []
      setOrders(rows)
      setLoading(false)

      // Pre-load job numbers for lodged orders
      const jobIds = [...new Set(rows.filter(o => o.job_id).map(o => o.job_id as string))]
      if (jobIds.length > 0) {
        const { data: jobs } = await supabase
          .from('jobs')
          .select('id, job_number')
          .in('id', jobIds)
        if (jobs) {
          const map: Record<string, string> = {}
          jobs.forEach((j: { id: string; job_number: string }) => { map[j.id] = j.job_number })
          setJobNumbers(map)
        }
      }
    }
    fetchOrders()
  }, [tenantId])

  // Debounced job search
  useEffect(() => {
    if (!linkSearch.trim() || !tenantId) {
      setLinkResults([])
      return
    }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    const term = linkSearch.trim()
    searchTimer.current = setTimeout(async () => {
      const { data } = await supabase
        .from('jobs')
        .select('id, job_number, insured_name, property_address, claim_number')
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
      setLodging(false)
      setLodgeError(null)
      setRejectOpen(false)
      setRejectReason('')
      setLinkOpen(false)
      setLinkSearch('')
      setLinkResults([])
      setEditToast(false)
    }
  }

  async function handleLodge(order: InsurerOrder) {
    setLodging(true)
    setLodgeError(null)
    try {
      const res = await fetch('/api/insurer-orders/lodge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id }),
      })
      const json = await res.json()
      if (!res.ok) {
        setLodgeError(json.error ?? 'Lodge failed')
        setLodging(false)
        return
      }
      const { jobNumber, jobId } = json as { jobNumber: string; jobId: string }
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, job_id: jobId, status: 'lodged' } : o))
      setJobNumbers(prev => ({ ...prev, [jobId]: jobNumber }))
    } catch {
      setLodgeError('Network error — please try again')
    }
    setLodging(false)
  }

  async function handleReject(order: InsurerOrder) {
    const updatedNotes = order.notes
      ? `${order.notes}\n\nRejected: ${rejectReason}`
      : `Rejected: ${rejectReason}`
    const { error } = await supabase
      .from('insurer_orders')
      .update({ status: 'rejected', notes: updatedNotes })
      .eq('id', order.id)
    if (!error) {
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'rejected', notes: updatedNotes } : o))
      setRejectOpen(false)
      setRejectReason('')
    }
  }

  async function handleLinkJob(order: InsurerOrder, job: JobHit) {
    const { error } = await supabase
      .from('insurer_orders')
      .update({ job_id: job.id, status: 'lodged' })
      .eq('id', order.id)
    if (!error) {
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, job_id: job.id, status: 'lodged' } : o))
      setJobNumbers(prev => ({ ...prev, [job.id]: job.job_number }))
      setLinkOpen(false)
      setLinkSearch('')
      setLinkResults([])
    }
  }

  function handleEdit() {
    setEditToast(true)
    if (editToastTimer.current) clearTimeout(editToastTimer.current)
    editToastTimer.current = setTimeout(() => setEditToast(false), 2000)
  }

  const filtered = filter === 'all' ? orders : orders.filter(o => o.status === filter)
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
      `}</style>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '36px 36px 60px' }}>

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
              padding: '14px 20px', borderLeft: '3px solid #c8b89a', minWidth: 130,
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

        {/* Table */}
        <div style={{ background: '#ffffff', border: '0.5px solid #e4dfd8', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 110 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 200 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 80 }} />
                <col style={{ width: 36 }} />
              </colgroup>
              <thead>
                <tr style={{ background: '#fdfdfc', borderBottom: '0.5px solid #e4dfd8' }}>
                  {['Order Ref', 'Claim #', 'Insured', 'Address', 'Insurer', 'Type', 'Loss Type', 'Date', 'Status', 'Linked Job', ''].map((col, i) => (
                    <th key={i} style={{
                      padding: '11px 16px', textAlign: 'left', fontSize: 10, fontWeight: 600,
                      color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.05em',
                      whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdfdfc', zIndex: 1,
                    }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ padding: '48px 16px', textAlign: 'center', color: '#b0a898', fontSize: 13 }}>
                      No orders found
                    </td>
                  </tr>
                ) : (
                  filtered.map(order => {
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
                          <td style={{ padding: '13px 16px', whiteSpace: 'nowrap', background: rowBg, borderLeft: leftBorder }}>
                            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#c8b89a', fontWeight: 500 }}>
                              {order.order_ref ?? order.id.slice(-8)}
                            </span>
                          </td>
                          <td style={{ padding: '13px 16px', whiteSpace: 'nowrap', background: rowBg }}>
                            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11 }}>
                              {order.claim_number}
                            </span>
                          </td>
                          <td style={{ padding: '13px 16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: rowBg }}>
                            {order.insured_name ?? '—'}
                          </td>
                          <td style={{ padding: '13px 16px', overflow: 'hidden', background: rowBg }}>
                            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {order.property_address ?? '—'}
                            </span>
                          </td>
                          <td style={{ padding: '13px 16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: rowBg }}>
                            {order.insurer ?? '—'}
                          </td>
                          <td style={{ padding: '13px 16px', whiteSpace: 'nowrap', background: rowBg }}>
                            <WoTypeBadge type={order.wo_type} />
                          </td>
                          <td style={{ padding: '13px 16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: rowBg }}>
                            {order.loss_type ?? '—'}
                          </td>
                          <td style={{ padding: '13px 16px', whiteSpace: 'nowrap', fontSize: 12, color: '#b0a898', background: rowBg }}>
                            {formatDate(order.date_of_loss)}
                          </td>
                          <td style={{ padding: '13px 16px', whiteSpace: 'nowrap', background: rowBg }}>
                            <StatusBadge status={order.status} />
                          </td>
                          <td style={{ padding: '13px 16px', background: rowBg }}>
                            {order.job_id ? (
                              <button
                                onClick={e => { e.stopPropagation(); router.push(`/dashboard/jobs/${order.job_id}`) }}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#c8b89a', display: 'flex', alignItems: 'center' }}
                                title="View linked job"
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                </svg>
                              </button>
                            ) : (
                              <span style={{ color: '#b0a898' }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: '13px 16px', textAlign: 'center', background: rowBg }}>
                            <span className={`chevron${isOpen ? ' open' : ''}`}>▸</span>
                          </td>
                        </tr>

                        {/* Expanded panel */}
                        {isOpen && (
                          <tr>
                            <td colSpan={11} style={{ padding: 0, borderBottom: '0.5px solid #e4dfd8' }}>
                              <div style={{
                                background: isLinked ? '#fffbeb' : '#fdfcfb',
                                borderTop: isLinked ? '2px solid #c8b89a' : '0.5px solid #f0ece6',
                                padding: '24px 28px',
                              }}>

                                {/* Linked banner */}
                                {isLinked && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '10px 14px', background: '#fef3c7', border: '1px solid #d97706', borderRadius: 6 }}>
                                    <span style={{ background: '#fef3c7', color: '#92400e', fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 20, border: '1px solid #d97706', whiteSpace: 'nowrap' }}>
                                      Already linked to {jobNum ?? order.job_id!.slice(-8)}
                                    </span>
                                    <button
                                      onClick={() => router.push(`/dashboard/jobs/${order.job_id}`)}
                                      style={{ ...ghostBtn, border: '1px solid #d97706', color: '#92400e' }}
                                    >
                                      Open Job →
                                    </button>
                                  </div>
                                )}

                                {/* Two-column field grid */}
                                <div style={{ display: 'grid', gridTemplateColumns: '55% 45%', gap: 32, marginBottom: 24 }}>

                                  {/* Left column */}
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px' }}>
                                    <F label="Order Ref" mono>{order.order_ref ?? '—'}</F>
                                    <F label="Insurer">{order.insurer ?? '—'}</F>
                                    <F label="WO Type">{order.wo_type ?? '—'}</F>
                                    <F label="Date of Loss">{formatDate(order.date_of_loss)}</F>
                                    <F label="Date Created">{formatDate(order.created_at)}</F>
                                    <F label="Sum Insured">{formatCurrency(order.sum_insured_building)}</F>
                                    <div style={{ gridColumn: '1 / -1' }}>
                                      <F label="Property Address">{order.property_address ?? '—'}</F>
                                    </div>
                                    <F label="Excess">{formatCurrency(order.excess_building)}</F>
                                  </div>

                                  {/* Right column */}
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px' }}>
                                    <F label="Claim Number" mono>{order.claim_number}</F>
                                    <F label="Adjuster">{order.adjuster ?? '—'}</F>
                                    <F label="Insured Name">{order.insured_name ?? '—'}</F>
                                    <F label="Loss Type">{order.loss_type ?? '—'}</F>
                                    <F label="Phone">
                                      {order.insured_phone
                                        ? <a href={`tel:${order.insured_phone}`} style={{ color: '#1a1a1a', textDecoration: 'none' }}>{order.insured_phone}</a>
                                        : '—'}
                                    </F>
                                    <F label="Email">
                                      {order.insured_email
                                        ? <a href={`mailto:${order.insured_email}`} style={{ color: '#1a1a1a', textDecoration: 'none' }}>{order.insured_email}</a>
                                        : '—'}
                                    </F>
                                    <F label="Entry Method">{order.entry_method ?? '—'}</F>
                                    {order.parse_status && <F label="Parse Status">{order.parse_status}</F>}
                                  </div>
                                </div>

                                {/* Full-width text sections */}
                                {order.claim_description && (
                                  <div style={{ marginBottom: 12 }}>
                                    <div style={{ fontSize: 9, fontWeight: 600, color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Claim Description</div>
                                    <div style={{ background: '#ffffff', border: '0.5px solid #e4dfd8', borderRadius: 6, padding: '12px 16px', fontSize: 13, color: '#3a3530', lineHeight: 1.7 }}>
                                      {order.claim_description}
                                    </div>
                                  </div>
                                )}
                                {order.special_instructions && (
                                  <div style={{ marginBottom: 12 }}>
                                    <div style={{ fontSize: 9, fontWeight: 600, color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Special Instructions</div>
                                    <div style={{ background: '#ffffff', border: '0.5px solid #e4dfd8', borderLeft: '3px solid #c8b89a', borderRadius: 6, padding: '12px 16px', fontSize: 13, color: '#3a3530', lineHeight: 1.7 }}>
                                      {order.special_instructions}
                                    </div>
                                  </div>
                                )}
                                {order.notes && (
                                  <div style={{ marginBottom: 12 }}>
                                    <div style={{ fontSize: 9, fontWeight: 600, color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Notes</div>
                                    <div style={{ background: '#ffffff', border: '0.5px solid #e4dfd8', borderRadius: 6, padding: '12px 16px', fontSize: 13, color: '#3a3530', lineHeight: 1.7 }}>
                                      {order.notes}
                                    </div>
                                  </div>
                                )}

                                {/* Action buttons */}
                                <div style={{ marginTop: 20 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    {isLinked ? (
                                      order.status === 'rejected' ? (
                                        <>
                                          <span style={{ background: '#fdecea', color: '#b91c1c', fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 20 }}>✗ Rejected</span>
                                          <button onClick={handleEdit} style={ghostBtn}>Edit</button>
                                        </>
                                      ) : order.status === 'lodged' ? (
                                        <>
                                          <span style={{ background: '#eaf3f0', color: '#2a6b50', fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 20 }}>
                                            ✓ Lodged as {jobNum ?? '…'}
                                          </span>
                                          <button onClick={() => router.push(`/dashboard/jobs/${order.job_id}`)} style={ghostBtn}>Open Job →</button>
                                          <button onClick={handleEdit} style={ghostBtn}>Edit</button>
                                        </>
                                      ) : (
                                        <>
                                          <button onClick={handleEdit} style={ghostBtn}>Edit</button>
                                          <button onClick={() => setRejectOpen(v => !v)} style={{ ...ghostBtn, color: '#b91c1c' }}>Reject</button>
                                        </>
                                      )
                                    ) : order.status === 'rejected' ? (
                                      <>
                                        <span style={{ background: '#fdecea', color: '#b91c1c', fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 20 }}>✗ Rejected</span>
                                        <button onClick={handleEdit} style={ghostBtn}>Edit</button>
                                      </>
                                    ) : (
                                      <>
                                        <button
                                          onClick={() => handleLodge(order)}
                                          disabled={lodging}
                                          style={{ ...greenBtn, opacity: lodging ? 0.7 : 1 }}
                                        >
                                          {lodging ? 'Lodging…' : 'Lodge Order'}
                                        </button>
                                        <button onClick={handleEdit} disabled={lodging} style={{ ...ghostBtn, opacity: lodging ? 0.5 : 1 }}>Edit</button>
                                        <button onClick={() => setRejectOpen(v => !v)} disabled={lodging} style={{ ...ghostBtn, color: '#b91c1c', opacity: lodging ? 0.5 : 1 }}>Reject</button>
                                        <button onClick={() => setLinkOpen(v => !v)} disabled={lodging} style={{ ...ghostBtn, opacity: lodging ? 0.5 : 1 }}>Link to existing job</button>
                                      </>
                                    )}
                                    {editToast && (
                                      <span style={{ fontSize: 12, color: '#b0a898', marginLeft: 4 }}>Edit coming soon</span>
                                    )}
                                  </div>

                                  {lodgeError && (
                                    <div style={{ marginTop: 8, fontSize: 12, color: '#b91c1c' }}>{lodgeError}</div>
                                  )}

                                  {/* Reject inline form */}
                                  {rejectOpen && !isLinked && order.status !== 'rejected' && (
                                    <div style={{ marginTop: 12, padding: '14px 16px', background: '#fdfcfb', border: '0.5px solid #e4dfd8', borderRadius: 6 }}>
                                      <div style={{ fontSize: 12, fontWeight: 600, color: '#3a3530', marginBottom: 8 }}>Reason for rejection</div>
                                      <textarea
                                        value={rejectReason}
                                        onChange={e => setRejectReason(e.target.value)}
                                        rows={3}
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

                                  {/* Link to existing job inline */}
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

      {/* New Order stub panel */}
      {newOrderOpen && (
        <>
          <div
            onClick={() => setNewOrderOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 40 }}
          />
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: 420,
            background: '#ffffff', borderLeft: '1px solid #e4dfd8', zIndex: 50,
            padding: '36px 32px', fontFamily: "'DM Sans', sans-serif",
            boxShadow: '-4px 0 24px rgba(0,0,0,0.08)',
          }}>
            <div style={{ fontSize: 12, color: '#b0a898', marginBottom: 8 }}>New Order</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a', marginBottom: 16 }}>Create Insurer Order</div>
            <div style={{ fontSize: 13, color: '#b0a898' }}>Coming soon — order creation panel.</div>
            <button
              onClick={() => setNewOrderOpen(false)}
              style={{ marginTop: 24, background: '#1a1a1a', color: '#f5f2ee', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
            >
              Close
            </button>
          </div>
        </>
      )}
    </div>
  )
}
