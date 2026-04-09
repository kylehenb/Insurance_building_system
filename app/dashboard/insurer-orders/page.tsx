'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/supabase/database.types'

type InsurerOrder = Database['public']['Tables']['insurer_orders']['Row']

type FilterStatus = 'all' | 'pending' | 'lodged' | 'rejected'

const supabase = createBrowserClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function formatDate(dateString: string | null): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function WoTypeBadge({ type }: { type: string | null }) {
  if (!type) {
    return (
      <span style={{ background: '#f3f4f6', color: '#6b7280', fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4 }}>
        Other
      </span>
    )
  }
  const lower = type.toLowerCase()
  if (lower === 'make safe') {
    return (
      <span style={{ background: '#fdecea', color: '#b91c1c', fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4 }}>
        Make Safe
      </span>
    )
  }
  if (lower === 'bar') {
    return (
      <span style={{ background: '#e8f0fe', color: '#1a56db', fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4 }}>
        BAR
      </span>
    )
  }
  if (lower === 'roof report') {
    return (
      <span style={{ background: '#f0eef8', color: '#4a42a0', fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4 }}>
        Roof Report
      </span>
    )
  }
  return (
    <span style={{ background: '#f3f4f6', color: '#6b7280', fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4 }}>
      {type}
    </span>
  )
}

function StatusBadge({ status }: { status: string | null }) {
  if (status === 'pending') {
    return (
      <span style={{ background: '#fdf5e8', color: '#8a6020', fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4 }}>
        Pending
      </span>
    )
  }
  if (status === 'lodged') {
    return (
      <span style={{ background: '#eaf3f0', color: '#2a6b50', fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4 }}>
        Lodged
      </span>
    )
  }
  if (status === 'rejected') {
    return (
      <span style={{ background: '#fdecea', color: '#b91c1c', fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4 }}>
        Rejected
      </span>
    )
  }
  return (
    <span style={{ background: '#f3f4f6', color: '#6b7280', fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4 }}>
      {status ?? '-'}
    </span>
  )
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 10 }).map((_, i) => (
        <td key={i} style={{ padding: '14px 16px' }}>
          <div
            style={{
              height: 14,
              borderRadius: 4,
              background: 'linear-gradient(90deg, #f0ece6 25%, #e8e3dc 50%, #f0ece6 75%)',
              backgroundSize: '200% 100%',
              animation: 'pulse 1.4s ease-in-out infinite',
              width: i === 3 ? '80%' : i === 0 ? '60%' : '70%',
            }}
          />
        </td>
      ))}
    </tr>
  )
}

export default function InsurerOrdersPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<InsurerOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterStatus>('all')
  const [panelOpen, setPanelOpen] = useState(false)
  const [tenantId, setTenantId] = useState<string | null>(null)

  useEffect(() => {
    async function bootstrap() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('id', user.id)
        .single()

      if (profileError || !profile) {
        console.log('Profile error:', profileError)
        router.push('/login')
        return
      }

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

      setOrders(data ?? [])
      setLoading(false)
    }
    fetchOrders()
  }, [tenantId])

  const filtered = filter === 'all'
    ? orders
    : orders.filter((o) => o.status === filter)

  const totalCount = orders.length
  const pendingCount = orders.filter((o) => o.status === 'pending').length
  const makeSafeCount = orders.filter((o) => o.is_make_safe === true).length

  const pillBase: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 500,
    padding: '5px 14px',
    borderRadius: 20,
    cursor: 'pointer',
    border: 'none',
    transition: 'background 0.15s, color 0.15s',
    fontFamily: "'DM Sans', sans-serif",
  }
  const pillActive: React.CSSProperties = { ...pillBase, background: '#1a1a1a', color: '#c8b89a' }
  const pillInactive: React.CSSProperties = { ...pillBase, background: 'transparent', color: '#3a3530', border: '1px solid #e4dfd8' }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f2ee', fontFamily: "'DM Sans', sans-serif", color: '#3a3530' }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { background-position: 200% 0; }
          50% { background-position: -200% 0; }
        }
        .order-row:hover { background: #faf9f7 !important; cursor: pointer; }
        .order-row td { transition: background 0.15s; }
      `}</style>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '36px 36px 60px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Insurer Orders</h1>
            <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
              {(['all', 'pending', 'lodged', 'rejected'] as FilterStatus[]).map((f) => (
                <button
                  key={f}
                  style={filter === f ? pillActive : pillInactive}
                  onClick={() => setFilter(f)}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => setPanelOpen(true)}
            style={{
              background: '#1a1a1a',
              color: '#f5f2ee',
              border: 'none',
              borderRadius: 8,
              padding: '9px 18px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: "'DM Sans', sans-serif",
              marginTop: 4,
            }}
          >
            New Order
          </button>
        </div>

        {/* Summary strip */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Total Orders', value: totalCount },
            { label: 'Pending', value: pendingCount },
            { label: 'Make Safes', value: makeSafeCount },
          ].map((card) => (
            <div
              key={card.label}
              style={{
                background: '#ffffff',
                border: '1px solid #e4dfd8',
                borderRadius: 8,
                padding: '14px 20px',
                borderLeft: '3px solid #c8b89a',
                minWidth: 130,
              }}
            >
              <div style={{ fontSize: 24, fontWeight: 700, color: '#1a1a1a', lineHeight: 1 }}>
                {loading ? '-' : card.value}
              </div>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 5 }}>
                {card.label}
              </div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div style={{ background: '#ffffff', border: '1px solid #e4dfd8', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#fdfdfc', borderBottom: '1px solid #e4dfd8' }}>
                  {['Order Ref', 'Claim #', 'Insured', 'Address', 'Insurer', 'Type', 'Loss Type', 'Date', 'Status', 'Linked Job'].map((col) => (
                    <th
                      key={col}
                      style={{
                        padding: '11px 16px',
                        textAlign: 'left',
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#b0a898',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        whiteSpace: 'nowrap',
                        position: 'sticky',
                        top: 0,
                        background: '#fdfdfc',
                        zIndex: 1,
                      }}
                    >
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
                    <td
                      colSpan={10}
                      style={{ padding: '48px 16px', textAlign: 'center', color: '#b0a898', fontSize: 13 }}
                    >
                      No orders found
                    </td>
                  </tr>
                ) : (
                  filtered.map((order) => (
                    <tr
                      key={order.id}
                      className="order-row"
                      style={{ borderBottom: '1px solid #f0ece6' }}
                    >
                      {/* Order Ref */}
                      <td
                        style={{ padding: '13px 16px', whiteSpace: 'nowrap' }}
                        onClick={() => router.push(`/dashboard/insurer-orders/${order.id}`)}
                      >
                        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#c8b89a', fontWeight: 500 }}>
                          {order.order_ref ?? order.id.slice(-8)}
                        </span>
                      </td>

                      {/* Claim # */}
                      <td
                        style={{ padding: '13px 16px', whiteSpace: 'nowrap' }}
                        onClick={() => router.push(`/dashboard/insurer-orders/${order.id}`)}
                      >
                        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: '#3a3530' }}>
                          {order.claim_number}
                        </span>
                      </td>

                      {/* Insured */}
                      <td
                        style={{ padding: '13px 16px', whiteSpace: 'nowrap' }}
                        onClick={() => router.push(`/dashboard/insurer-orders/${order.id}`)}
                      >
                        {order.insured_name ?? '-'}
                      </td>

                      {/* Address */}
                      <td
                        style={{ padding: '13px 16px', maxWidth: 200 }}
                        onClick={() => router.push(`/dashboard/insurer-orders/${order.id}`)}
                      >
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {order.property_address ?? '-'}
                        </span>
                      </td>

                      {/* Insurer */}
                      <td
                        style={{ padding: '13px 16px', whiteSpace: 'nowrap' }}
                        onClick={() => router.push(`/dashboard/insurer-orders/${order.id}`)}
                      >
                        {order.insurer ?? '-'}
                      </td>

                      {/* Type */}
                      <td
                        style={{ padding: '13px 16px', whiteSpace: 'nowrap' }}
                        onClick={() => router.push(`/dashboard/insurer-orders/${order.id}`)}
                      >
                        <WoTypeBadge type={order.wo_type} />
                      </td>

                      {/* Loss Type */}
                      <td
                        style={{ padding: '13px 16px', whiteSpace: 'nowrap' }}
                        onClick={() => router.push(`/dashboard/insurer-orders/${order.id}`)}
                      >
                        {order.loss_type ?? '-'}
                      </td>

                      {/* Date */}
                      <td
                        style={{ padding: '13px 16px', whiteSpace: 'nowrap', fontSize: 12, color: '#b0a898' }}
                        onClick={() => router.push(`/dashboard/insurer-orders/${order.id}`)}
                      >
                        {formatDate(order.date_of_loss)}
                      </td>

                      {/* Status */}
                      <td
                        style={{ padding: '13px 16px', whiteSpace: 'nowrap' }}
                        onClick={() => router.push(`/dashboard/insurer-orders/${order.id}`)}
                      >
                        <StatusBadge status={order.status} />
                      </td>

                      {/* Linked Job */}
                      <td style={{ padding: '13px 16px', whiteSpace: 'nowrap' }}>
                        {order.job_id ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              router.push(`/dashboard/jobs/${order.job_id}`)
                            }}
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
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* New Order slide-in panel (stub) */}
      {panelOpen && (
        <>
          <div
            onClick={() => setPanelOpen(false)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 40,
            }}
          />
          <div
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0, width: 420,
              background: '#ffffff', borderLeft: '1px solid #e4dfd8',
              zIndex: 50, padding: '36px 32px', fontFamily: "'DM Sans', sans-serif",
              boxShadow: '-4px 0 24px rgba(0,0,0,0.08)',
            }}
          >
            <div style={{ fontSize: 12, color: '#b0a898', marginBottom: 8 }}>New Order</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a', marginBottom: 16 }}>Create Insurer Order</div>
            <div style={{ fontSize: 13, color: '#b0a898' }}>Coming soon — order creation panel.</div>
            <button
              onClick={() => setPanelOpen(false)}
              style={{
                marginTop: 24, background: '#1a1a1a', color: '#f5f2ee',
                border: 'none', borderRadius: 8, padding: '9px 18px',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              Close
            </button>
          </div>
        </>
      )}
    </div>
  )
}
