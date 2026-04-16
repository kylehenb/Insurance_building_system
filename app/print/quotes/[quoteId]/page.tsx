import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'
import { PrintButton } from './PrintButton'

type Quote = Database['public']['Tables']['quotes']['Row']
type ScopeItem = Database['public']['Tables']['scope_items']['Row']
type Job = Database['public']['Tables']['jobs']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']

type ItemType = 'provisional_sum' | 'prime_cost' | 'cash_settlement' | null

const ITEM_TYPE_LABELS: Record<NonNullable<ItemType>, { label: string; pill: string; color: string; border: string }> = {
  provisional_sum: { label: 'Provisional Sum', pill: 'PS', color: '#b45309', border: '#f59e0b' },
  prime_cost:      { label: 'Prime Cost',      pill: 'PC', color: '#1a73e8', border: '#60a5fa' },
  cash_settlement: { label: 'Cash Settlement', pill: 'CS', color: '#64748b', border: '#94a3b8' },
}

export default async function QuotePrintPage({
  params,
}: {
  params: Promise<{ quoteId: string }>
}) {
  const { quoteId } = await params

  const supabase = await createClient()

  // Check authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }

  // Get user's tenant_id
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (userError || !userData) {
    redirect('/login')
  }

  const tenantId = userData.tenant_id

  // Fetch quote
  const { data: quote, error: quoteError } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', quoteId)
    .eq('tenant_id', tenantId)
    .single()

  if (quoteError || !quote) {
    return <div>Quote not found</div>
  }

  // Fetch scope items
  const { data: scopeItems, error: itemsError } = await supabase
    .from('scope_items')
    .select('*')
    .eq('quote_id', quoteId)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })

  if (itemsError) {
    return <div>Error fetching scope items</div>
  }

  // Fetch job details
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', quote.job_id)
    .eq('tenant_id', tenantId)
    .single()

  if (jobError || !job) {
    return <div>Job not found</div>
  }

  // Fetch tenant details
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', tenantId)
    .single()

  if (tenantError || !tenant) {
    return <div>Tenant not found</div>
  }

  const formatDate = (date: string | null) => {
    if (!date) return ''
    return new Date(date).toLocaleDateString('en-AU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    })
  }

  const items = (scopeItems || []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  // Group items by room
  const groupedByRoom = items.reduce((acc, item) => {
    const room = item.room || 'Unassigned'
    if (!acc[room]) {
      acc[room] = []
    }
    acc[room].push(item)
    return acc
  }, {} as Record<string, ScopeItem[]>)

  // Sort rooms based on room_order from quote if available
  const sortedRooms = (() => {
    const roomNames = Object.keys(groupedByRoom)
    if (quote.room_order && quote.room_order.length > 0) {
      const orderMap = new Map(quote.room_order.map((r, i) => [r, i]))
      return roomNames.sort((a, b) => {
        const aIdx = orderMap.get(a) ?? 999
        const bIdx = orderMap.get(b) ?? 999
        return aIdx - bIdx
      })
    }
    // If no room_order, sort alphabetically
    return roomNames.sort((a, b) => a.localeCompare(b))
  })()

  // Calculate totals
  const subtotal = items.reduce((sum, item) => sum + (item.line_total || 0), 0)
  const markup = subtotal * (quote.markup_pct || 0.2)
  const subtotalAfterMarkup = subtotal + markup
  const gst = subtotalAfterMarkup * (quote.gst_pct || 0.1)
  const total = subtotalAfterMarkup + gst

  // Calculate room subtotals
  const roomSubtotals = Object.entries(groupedByRoom).reduce((acc, [room, roomItems]) => {
    acc[room] = roomItems.reduce((sum, item) => sum + (item.line_total || 0), 0)
    return acc
  }, {} as Record<string, number>)

  // Group special item types
  const provisionalSumItems = items.filter(i => i.item_type === 'provisional_sum')
  const primeCostItems = items.filter(i => i.item_type === 'prime_cost')
  const cashSettlementItems = items.filter(i => i.item_type === 'cash_settlement')

  const fmt = (v: number | null | undefined) => {
    if (v == null) return '$0.00'
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(v)
  }

  return (
    <div className="min-h-screen bg-[#f5f2ee] print:bg-white">
      {/* Document container */}
      <div className="max-w-4xl mx-auto bg-white shadow-lg min-h-screen print:shadow-none print:min-h-0 print:p-0">
        <PrintButton quoteRef={quote.quote_ref} jobNumber={job.job_number} />

        {/* Header - 3-column grid */}
        <div style={{ display: 'flex', alignItems: 'stretch', backgroundColor: 'white' }}>
          {/* Column 1: Logo (148px fixed) */}
          <div style={{ width: '148px', minWidth: '148px', padding: '14px 8px 14px 20px', borderRight: '1px solid #e0dbd4' }}>
            <img src="/logo-alt.png" alt="IRC Logo" style={{ width: '100%', height: 'auto', display: 'block', marginBottom: '5px' }} />
            <div style={{ fontSize: '6.5px', letterSpacing: '1.8px', textTransform: 'uppercase', color: '#9e998f', fontWeight: '700', whiteSpace: 'nowrap' }}>INSURANCE REPAIR CO</div>
          </div>

          {/* Column 2: Job details (flex: 1) */}
          <div style={{ flex: 1, padding: '14px 16px', borderRight: '1px solid #e0dbd4' }}>
            <div style={{ fontSize: '11.5px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#b0a89e', fontWeight: '700', marginBottom: '7px' }}>JOB DETAILS</div>
            {job.insured_name && (
              <div style={{ fontSize: '16px', fontWeight: '600', color: '#1a1a1a', marginBottom: '2px' }}>{job.insured_name}</div>
            )}
            {job.property_address && (
              <div style={{ fontSize: '13px', color: '#9e998f', marginBottom: '10px' }}>{job.property_address}</div>
            )}
            {/* Field strip */}
            <div style={{ display: 'flex', flexWrap: 'wrap', fontSize: '12px' }}>
              {[
                { label: 'Insurer',    value: job.insurer },
                { label: 'Claim #',    value: job.claim_number },
                { label: 'Adjuster',   value: job.adjuster },
                { label: 'Quote date', value: formatDate(quote.created_at) },
              ].map((field, i, arr) => (
                <span key={field.label} style={{ paddingRight: '8px', marginRight: '8px', borderRight: i < arr.length - 1 ? '1px solid #e0dbd4' : 'none' }}>
                  <span style={{ color: '#b0a89e' }}>{field.label}: </span>
                  <span style={{ color: '#3a3530' }}>{field.value || '—'}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Column 3: Contact (184px fixed) */}
          <div style={{ width: '184px', minWidth: '184px', padding: '14px 20px 14px 16px' }}>
            <div style={{ fontSize: '11.5px', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#b0a89e', fontWeight: '700', marginBottom: '7px' }}>CONTACT</div>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a1a1a', marginBottom: '3px' }}>Kyle Bindon</div>
            <div style={{ fontSize: '12px', color: '#9e998f', marginBottom: '2px' }}>kyle@insurancerepairco.com.au</div>
            <div style={{ fontSize: '12px', color: '#9e998f', marginBottom: '2px' }}>0431 132 077</div>
            {/* Badge row */}
            <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
              {['BC105884', 'IICRC Certified'].map(badge => (
                <span key={badge} style={{ fontSize: '9.5px', background: '#f5f2ee', color: '#6a6460', border: '1px solid #e0dbd4', borderRadius: '3px', padding: '2px 6px', fontWeight: '700' }}>{badge}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Form band */}
        <div style={{ borderTop: '1px solid #e0dbd4', borderBottom: '1px solid #e0dbd4', padding: '4px 20px 4px', position: 'relative', textAlign: 'center' }}>
          <span style={{ position: 'absolute', left: '20px', top: '4px', fontSize: '15px', fontWeight: '700', color: '#1a1a1a', fontFamily: 'DM Mono, monospace', letterSpacing: '-0.5px' }}>{quote.quote_ref}</span>
          <span style={{ fontSize: '16px', fontWeight: '700', color: '#9e998f', textTransform: 'uppercase', letterSpacing: '2px' }}>Estimate — Scope of Works</span>
        </div>

        {/* Scope Items by Room */}
        <div style={{ paddingLeft: '20px', paddingRight: '20px', paddingBottom: '8px' }}>
          {/* Table Header */}
          <table className="w-full text-[10px] border-collapse mb-0" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr className="bg-[#fafaf8] border-b border-[#e8e4e0]">
                <th className="text-center py-2 px-1 font-semibold text-[#b0a89e] text-[8px] uppercase tracking-wider" style={{ width: '4%', fontFamily: 'var(--font-dm-sans)' }}>#</th>
                <th className="text-left py-2 px-2 font-semibold text-[#b0a89e] text-[8px] uppercase tracking-wider" style={{ width: '60%', fontFamily: 'var(--font-dm-sans)' }}>Description</th>
                <th className="text-center py-2 px-2 font-semibold text-[#b0a89e] text-[8px] uppercase tracking-wider" style={{ width: '5%', fontFamily: 'var(--font-dm-sans)' }}>Qty</th>
                <th className="text-center py-2 px-2 font-semibold text-[#b0a89e] text-[8px] uppercase tracking-wider" style={{ width: '5%', fontFamily: 'var(--font-dm-sans)' }}>Unit</th>
                <th className="text-left py-2 px-2 font-semibold text-[#b0a89e] text-[8px] uppercase tracking-wider" style={{ width: '15%', fontFamily: 'var(--font-dm-sans)' }}>Trade</th>
                <th className="text-right py-2 px-2 font-semibold text-[#b0a89e] text-[8px] uppercase tracking-wider whitespace-nowrap" style={{ width: '15%', fontFamily: 'var(--font-dm-sans)' }}>Line Total</th>
              </tr>
            </thead>
          </table>
          {(() => {
            let globalCounter = 0
            return sortedRooms.map((room) => {
              const roomItems = groupedByRoom[room]
              // Get room dimensions from first item in the room that has dimensions
              const itemWithDimensions = roomItems.find(
                item => item.room_length != null || item.room_width != null || item.room_height != null
              )
              const roomLength = itemWithDimensions?.room_length
              const roomWidth = itemWithDimensions?.room_width
              const roomHeight = itemWithDimensions?.room_height
              const hasDimensions = roomLength != null || roomWidth != null || roomHeight != null
              const roomSizeStr = hasDimensions 
                ? `${roomLength != null ? roomLength : '—'} × ${roomWidth != null ? roomWidth : '—'} × ${roomHeight != null ? roomHeight : '—'} m` 
                : ''

              return (
                <div key={room} className="mb-4">
                  {/* Room header with dimensions - light beige background */}
                  <div style={{ paddingTop: '4px', paddingBottom: '4px', paddingLeft: '12px', paddingRight: '12px', borderBottom: '1px solid #e0dbd4', backgroundColor: '#f5f2ee' }}>
                    <h4 className="font-bold text-[#3a3530] text-xs uppercase" style={{ fontFamily: 'var(--font-dm-sans)' }}>
                      {room}
                      {hasDimensions && (
                        <span className="text-xs text-[#9e998f] font-mono ml-2" style={{ fontFamily: 'var(--font-dm-mono)' }}>{roomSizeStr}</span>
                      )}
                    </h4>
                  </div>
                  
                  {/* Table */}
                  <table className="w-full text-[10px] border-collapse" style={{ tableLayout: 'fixed' }}>
                    <tbody>
                      {roomItems.map((item) => {
                        globalCounter++
                        const itemType = item.item_type as ItemType
                        const typeInfo = itemType ? ITEM_TYPE_LABELS[itemType] : null
                        const leftBorderColor = typeInfo?.border ?? 'transparent'
                        
                        return (
                          <tr 
                            key={item.id} 
                            className="border-b border-[#f0ece6]"
                            style={{ 
                              borderLeft: itemType ? `3px solid ${leftBorderColor}` : '3px solid transparent',
                              borderRight: itemType ? `3px solid ${leftBorderColor}` : '3px solid transparent'
                            }}
                          >
                            <td className="py-1.5 px-1 text-center text-[#3a3530]" style={{ width: '4%', fontFamily: 'var(--font-dm-mono)', fontSize: '10px' }}>{globalCounter}</td>
                            <td className="py-1.5 px-2 text-[#3a3530]" style={{ width: '60%', fontFamily: 'var(--font-dm-sans)' }}>
                            {typeInfo && (
                              <div className="mb-0.5">
                                <span
                                  className="inline-block px-1 py-0.5 rounded text-[8px] font-bold"
                                  style={{ 
                                    background: `${leftBorderColor}22`, 
                                    color: typeInfo.color 
                                  }}
                                >
                                  {typeInfo.label}
                                </span>
                              </div>
                            )}
                            {item.item_description || '-'}
                          </td>
                          <td className="py-1.5 px-2 text-center text-[#3a3530]" style={{ width: '5%', fontFamily: 'var(--font-dm-sans)' }}>{item.qty || '-'}</td>
                          <td className="py-1.5 px-2 text-center text-[#3a3530]" style={{ width: '5%', fontFamily: 'var(--font-dm-sans)' }}>{item.unit || '-'}</td>
                          <td className="py-1.5 px-2 text-left text-[#3a3530]" style={{ width: '15%', fontFamily: 'var(--font-dm-sans)' }}>{item.trade || '-'}</td>
                          <td className="py-1.5 px-2 text-right text-[#3a3530] font-mono whitespace-nowrap" style={{ width: '15%', fontFamily: 'var(--font-dm-mono)' }}>
                            {fmt(item.line_total)}
                          </td>
                        </tr>
                      )
                    })}
                    </tbody>
                  </table>
                </div>
              )
            })
          })()}
        </div>

        {/* Footer Section - Notes left, Totals right - in light beige box with rounded corners */}
        <div style={{ paddingLeft: '20px', paddingRight: '20px', paddingBottom: '80px' }}>
          <div className="bg-[#f5f2ee] rounded-lg p-3">
            <div className="flex gap-6">
              {/* Notes - Left column */}
              <div className="flex-1">
                <p className="text-[#b0a89e] text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ fontFamily: 'var(--font-dm-sans)' }}>Notes</p>
                <div className="text-[10px] text-[#3a3530] whitespace-pre-wrap" style={{ fontFamily: 'var(--font-dm-sans)' }}>{quote.notes || ''}</div>
              </div>

              {/* Totals - Right column */}
              <div className="w-72">
                <div className="flex justify-between mb-2">
                  <span className="text-xs text-[#3a3530]" style={{ fontFamily: 'var(--font-dm-sans)' }}>Subtotal</span>
                  <span className="text-xs text-[#3a3530]" style={{ fontFamily: 'var(--font-dm-mono)' }}>{fmt(subtotal)}</span>
                </div>
                <div className="flex justify-between mb-2">
                  <span className="text-xs text-[#3a3530]" style={{ fontFamily: 'var(--font-dm-sans)' }}>Builder's Margin ({((quote.markup_pct || 0.2) * 100).toFixed(0)}%)</span>
                  <span className="text-xs text-[#3a3530]" style={{ fontFamily: 'var(--font-dm-mono)' }}>{fmt(markup)}</span>
                </div>
                <div className="flex justify-between mb-2">
                  <span className="text-xs text-[#3a3530]" style={{ fontFamily: 'var(--font-dm-sans)' }}>GST ({((quote.gst_pct || 0.1) * 100).toFixed(0)}%)</span>
                  <span className="text-xs text-[#3a3530]" style={{ fontFamily: 'var(--font-dm-mono)' }}>{fmt(gst)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-[#e0dbd4]">
                  <span className="text-sm font-semibold text-[#3a3530] uppercase" style={{ fontFamily: 'var(--font-dm-sans)' }}>Total inc GST</span>
                  <span className="text-base font-bold text-[#3a3530]" style={{ fontFamily: 'var(--font-dm-mono)' }}>{fmt(total)}</span>
                </div>

                {/* Informational breakdown for special item types */}
                {(provisionalSumItems.length > 0 || primeCostItems.length > 0 || cashSettlementItems.length > 0) && (
                  <div className="mt-4 pt-4 border-t border-dashed border-[#e0dbd4]">
                    <p className="text-[#b0a89e] text-[7px] uppercase tracking-wider font-semibold mb-2">Informational breakdown</p>
                    {provisionalSumItems.length > 0 && (
                      <div 
                        className="flex justify-between mb-1 px-2"
                        style={{ 
                          borderLeft: '3px solid #f59e0b',
                          borderRight: '3px solid #f59e0b'
                        }}
                      >
                        <span className="text-[10px] text-[#3a3530]">Provisional Sum Items incl GST</span>
                        <span className="font-mono text-[10px] text-[#3a3530]">{fmt(provisionalSumItems.reduce((sum, i) => sum + (i.line_total || 0), 0) * 1.1)}</span>
                      </div>
                    )}
                    {primeCostItems.length > 0 && (
                      <div 
                        className="flex justify-between mb-1 px-2"
                        style={{ 
                          borderLeft: '3px solid #60a5fa',
                          borderRight: '3px solid #60a5fa'
                        }}
                      >
                        <span className="text-[10px] text-[#3a3530]">Prime Cost Items incl GST</span>
                        <span className="font-mono text-[10px] text-[#3a3530]">{fmt(primeCostItems.reduce((sum, i) => sum + (i.line_total || 0), 0) * 1.1)}</span>
                      </div>
                    )}
                    {cashSettlementItems.length > 0 && (
                      <div 
                        className="flex justify-between mb-1 px-2"
                        style={{ 
                          borderLeft: '3px solid #94a3b8',
                          borderRight: '3px solid #94a3b8'
                        }}
                      >
                        <span className="text-[10px] text-[#3a3530]">Cash Settlement Items incl GST</span>
                        <span className="font-mono text-[10px] text-[#3a3530]">{fmt(cashSettlementItems.reduce((sum, i) => sum + (i.line_total || 0), 0) * 1.1)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ background: '#1a1a1a', padding: '9px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        {/* Small logo circle */}
        <div style={{ width: '26px', height: '26px', border: '1.5px solid #c8b89a', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <img src="/logo.png?v=1" alt="IRC" style={{ height: '16px' }} />
        </div>
        {/* Company name block */}
        <div>
          <div style={{ fontSize: '7.5px', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase', color: '#f5f2ee', textAlign: 'center' }}>INSURANCE REPAIR CO PTY LTD</div>
          <div style={{ fontSize: '10px', color: '#c8b89a', textAlign: 'center' }}>Building &amp; Restoration</div>
        </div>
        {/* Vertical divider */}
        <div style={{ width: '1px', height: '22px', background: '#c8b89a', margin: '0 4px', flexShrink: 0 }}></div>
        {/* License text */}
        <span style={{ fontSize: '12px', color: '#c8b89a' }}>BC105884 · IICRC Certified</span>
        {/* Spacer */}
        <div style={{ flex: 1 }}></div>
        {/* Right side reserved for future per-form content */}
      </div>
    </div>
  )
}
