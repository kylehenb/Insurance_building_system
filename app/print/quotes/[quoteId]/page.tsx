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

  const items = (scopeItems || []).sort((a, b) => a.sort_order - b.sort_order)

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
      <PrintButton />

      {/* Document container */}
      <div className="max-w-4xl mx-auto bg-white shadow-lg min-h-screen print:shadow-none print:min-h-0 print:p-0">
        {/* Header - Split layout: black left with logo, white right with job details */}
        <div className="flex">
          {/* Left: Black background with logo and company name - exactly as sidebar */}
          <div className="bg-[#1a1a1a] p-4 flex items-center justify-center" style={{ width: '160px', minWidth: '160px' }}>
            <div className="text-center">
              <img src="/logo.png" alt="IRC Logo" className="block mx-auto mb-2" style={{ width: '90px', height: '90px', objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
              <div className="text-[#6a6460]" style={{ fontSize: '10px', letterSpacing: '2.5px', textTransform: 'uppercase', fontWeight: '700', textAlign: 'center', lineHeight: '1.2' }}>Insurance Repair Co.</div>
            </div>
          </div>

          {/* Right: White background with job details - matching job detail shell layout */}
          <div className="flex-1 bg-white px-6 py-4">
            {/* Title row */}
            <div className="flex items-start gap-3 mb-1">
              <h1 className="text-[22px] font-semibold text-[#1a1a1a]" style={{ fontFamily: 'DM Mono, monospace' }}>
                {quote.quote_ref || job.job_number}
              </h1>
            </div>
            {job.insured_name && (
              <p className="text-[14px] font-medium text-[#3a3530] mb-0.5">{job.insured_name}</p>
            )}
            {job.property_address && (
              <p className="text-[13px] text-[#9e998f] mb-2">{job.property_address}</p>
            )}

            {/* Compact field strip */}
            <div className="flex items-center flex-wrap gap-0 text-[12px] text-[#9e998f]">
              {[
                { label: 'Insurer',      value: job.insurer },
                { label: 'Claim #',      value: job.claim_number },
                { label: 'Loss Type',    value: job.loss_type },
                { label: 'Date of Loss', value: job.date_of_loss ? formatDate(job.date_of_loss) : '—' },
                { label: 'Adjuster',     value: job.adjuster },
                { label: 'Quote Date',   value: formatDate(quote.created_at) },
              ].filter(item => item.value || item.label === 'Quote Date').map((item, i, arr) => (
                <span
                  key={item.label}
                  className="flex items-center pr-4 mr-4"
                  style={{ borderRight: i < arr.length - 1 ? '1px solid #e0dbd4' : 'none' }}
                >
                  <span className="mr-1 text-[#b0a898]">{item.label}:</span>
                  <span className="text-[#3a3530]">{item.value || '—'}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Title */}
        <div className="px-6 py-2 bg-white">
          <h2 className="text-base font-semibold text-[#1a1a1a]">Estimate - Scope of Works</h2>
        </div>

        {/* Scope Items by Room */}
        <div className="px-6 pb-6">
          {sortedRooms.map((room) => {
            const roomItems = groupedByRoom[room]
            // Get room dimensions from first item in the room
            const firstItem = roomItems[0]
            const roomLength = firstItem?.room_length
            const roomWidth = firstItem?.room_width
            const roomHeight = firstItem?.room_height
            const hasDimensions = roomLength || roomWidth || roomHeight
            const roomSizeStr = hasDimensions 
              ? `${roomLength || '—'} × ${roomWidth || '—'} × ${roomHeight || '—'} m` 
              : ''

            return (
              <div key={room} className="mb-6">
                {/* Room header with dimensions */}
                <div className="bg-[#e8e0d5] p-3 border-t-2 border-[#d0c8bc]">
                  <h4 className="font-semibold text-[#3a3530] text-sm">
                    {room}
                    {hasDimensions && (
                      <span className="text-xs text-[#9e998f] font-mono ml-2">{roomSizeStr}</span>
                    )}
                  </h4>
                </div>
                
                {/* Table */}
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-[#fafaf8] border-b border-[#e8e4e0]">
                      <th className="text-left py-2 px-2 font-semibold text-[#b0a89e] text-xs uppercase tracking-wider" style={{ width: '60%' }}>Description</th>
                      <th className="text-center py-2 px-2 font-semibold text-[#b0a89e] text-xs uppercase tracking-wider w-14">Qty</th>
                      <th className="text-center py-2 px-2 font-semibold text-[#b0a89e] text-xs uppercase tracking-wider w-14">Unit</th>
                      <th className="text-left py-2 px-2 font-semibold text-[#b0a89e] text-xs uppercase tracking-wider">Trade</th>
                      <th className="text-right py-2 px-2 font-semibold text-[#b0a89e] text-xs uppercase tracking-wider w-28">Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roomItems.map((item) => {
                      const itemType = item.item_type as ItemType
                      const typeInfo = itemType ? ITEM_TYPE_LABELS[itemType] : null
                      const leftBorderColor = typeInfo?.border ?? 'transparent'
                      
                      return (
                        <tr 
                          key={item.id} 
                          className="border-b border-[#f0ece6]"
                          style={{ borderLeft: itemType ? `3px solid ${leftBorderColor}` : '3px solid transparent' }}
                        >
                          <td className="py-2 px-2 text-[#3a3530]">
                            {item.item_description || '-'}
                          </td>
                          <td className="py-2 px-2 text-center text-[#3a3530]">{item.qty || '-'}</td>
                          <td className="py-2 px-2 text-center text-[#3a3530]">{item.unit || '-'}</td>
                          <td className="py-2 px-2 text-left text-[#3a3530]">{item.trade || '-'}</td>
                          <td className="py-2 px-2 text-right text-[#3a3530] font-mono whitespace-nowrap">
                            {typeInfo && (
                              <span
                                className="inline-block mr-1 px-1 py-0.5 rounded text-[8px] font-bold"
                                style={{ 
                                  background: `${leftBorderColor}22`, 
                                  color: typeInfo.color 
                                }}
                              >
                                {typeInfo.label}
                              </span>
                            )}
                            {fmt(item.line_total)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>

        {/* Footer Section - Notes left, Totals right */}
        <div className="px-6 pb-6 border-t border-[#e0dbd4] bg-white">
          <div className="flex gap-6">
            {/* Notes - Left column */}
            <div className="flex-1">
              <p className="text-[#b0a89e] text-xs uppercase tracking-wider font-semibold mb-2">Notes</p>
              <div className="text-sm text-[#3a3530] whitespace-pre-wrap">{quote.notes || ''}</div>
            </div>

            {/* Totals - Right column */}
            <div className="w-72">
              <div className="flex justify-between mb-2">
                <span className="text-sm text-[#9e998f]">Subtotal</span>
                <span className="font-mono text-sm text-[#3a3530]">{fmt(subtotal)}</span>
              </div>
              <div className="flex justify-between mb-2">
                <span className="text-sm text-[#9e998f]">Builder's Margin ({((quote.markup_pct || 0.2) * 100).toFixed(0)}%)</span>
                <span className="font-mono text-sm text-[#3a3530]">{fmt(markup)}</span>
              </div>
              <div className="flex justify-between mb-2">
                <span className="text-sm text-[#9e998f]">GST ({((quote.gst_pct || 0.1) * 100).toFixed(0)}%)</span>
                <span className="font-mono text-sm text-[#3a3530]">{fmt(gst)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-[#e0dbd4]">
                <span className="text-base font-semibold text-[#3a3530]">Total inc GST</span>
                <span className="font-mono text-lg font-bold text-[#3a3530]">{fmt(total)}</span>
              </div>

              {/* Informational breakdown for special item types */}
              {(provisionalSumItems.length > 0 || primeCostItems.length > 0 || cashSettlementItems.length > 0) && (
                <div className="mt-4 pt-4 border-t border-dashed border-[#e0dbd4]">
                  <p className="text-[#b0a89e] text-[9px] uppercase tracking-wider font-semibold mb-2">Informational breakdown</p>
                  {provisionalSumItems.length > 0 && (
                    <div className="flex justify-between mb-1">
                      <span className="text-xs text-[#9e998f]">Provisional Sum Items</span>
                      <span className="font-mono text-xs text-[#3a3530]">{fmt(provisionalSumItems.reduce((sum, i) => sum + (i.line_total || 0), 0))}</span>
                    </div>
                  )}
                  {primeCostItems.length > 0 && (
                    <div className="flex justify-between mb-1">
                      <span className="text-xs text-[#9e998f]">Prime Cost Items</span>
                      <span className="font-mono text-xs text-[#3a3530]">{fmt(primeCostItems.reduce((sum, i) => sum + (i.line_total || 0), 0))}</span>
                    </div>
                  )}
                  {cashSettlementItems.length > 0 && (
                    <div className="flex justify-between mb-1">
                      <span className="text-xs text-[#9e998f]">Cash Settlement Items</span>
                      <span className="font-mono text-xs text-[#3a3530]">{fmt(cashSettlementItems.reduce((sum, i) => sum + (i.line_total || 0), 0))}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Black Footer */}
      <div className="bg-[#1a1a1a] text-white p-6">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src="/logo.png" alt="IRC Logo" className="h-12 w-auto brightness-0 invert" />
            <div>
              <p className="font-bold text-sm tracking-widest uppercase">{tenant.name}</p>
              <p className="text-xs text-[#6a6460]">Insurance Repair Co.</p>
            </div>
          </div>
          <div className="text-right text-sm">
            <p className="text-[#6a6460]">PHONE: {tenant.contact_phone || '1800-009-0061'}</p>
            <p className="text-[#6a6460]">EMAIL: {tenant.contact_email || 'info@ircmaster.com.au'}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
