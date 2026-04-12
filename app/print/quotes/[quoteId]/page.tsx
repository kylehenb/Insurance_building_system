import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'
import { PrintButton } from './PrintButton'

type Quote = Database['public']['Tables']['quotes']['Row']
type ScopeItem = Database['public']['Tables']['scope_items']['Row']
type Job = Database['public']['Tables']['jobs']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']

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
    <div className="min-h-screen bg-[#f5f0e8] print:bg-white">
      <PrintButton />

      {/* Document container */}
      <div className="max-w-4xl mx-auto bg-white shadow-lg min-h-screen print:shadow-none print:min-h-0 print:p-0">
        {/* Header */}
        <div className="bg-[#f5f0e8] p-6 flex items-center justify-between">
          {/* Logo on left */}
          <div className="flex items-center">
            <img src="/logo.png" alt="Logo" className="h-16 w-auto" />
          </div>
          
          {/* Job details in center and right */}
          <div className="flex-1 flex justify-end gap-12 text-sm">
            <div className="text-right">
              <p className="font-bold text-[#1a1a1a]">Quote Reference</p>
              <p className="text-[#1a1a1a]">{quote.quote_ref || '-'}</p>
            </div>
            <div className="text-right">
              <p className="font-bold text-[#1a1a1a]">Date</p>
              <p className="text-[#1a1a1a]">{formatDate(quote.created_at)}</p>
            </div>
            <div className="text-right">
              <p className="font-bold text-[#1a1a1a]">Job Number</p>
              <p className="text-[#1a1a1a]">{job.job_number}</p>
            </div>
            <div className="text-right">
              <p className="font-bold text-[#1a1a1a]">Claim Number</p>
              <p className="text-[#1a1a1a]">{job.claim_number || '-'}</p>
            </div>
          </div>
        </div>

        {/* Title */}
        <div className="py-3 bg-[#f5f0e8]">
          <h2 className="text-xl font-bold text-[#1a1a1a] text-center">Estimate - Scope of Works</h2>
        </div>

        {/* Scope of Works */}
        <div className="p-6">
          {/* Insured Details */}
          <div className="mb-6 p-4 bg-[#f5f0e8] print:bg-gray-50">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-semibold text-[#666]">Insured Name:</span>
                <span className="ml-2 text-[#1a1a1a]">{job.insured_name || '-'}</span>
              </div>
              <div>
                <span className="font-semibold text-[#666]">Property Address:</span>
                <span className="ml-2 text-[#1a1a1a]">{job.property_address || '-'}</span>
              </div>
              <div>
                <span className="font-semibold text-[#666]">Claim Number:</span>
                <span className="ml-2 text-[#1a1a1a]">{job.claim_number || '-'}</span>
              </div>
              <div>
                <span className="font-semibold text-[#666]">Insurer:</span>
                <span className="ml-2 text-[#1a1a1a]">{job.insurer || '-'}</span>
              </div>
              <div>
                <span className="font-semibold text-[#666]">Date of Loss:</span>
                <span className="ml-2 text-[#1a1a1a]">{formatDate(job.date_of_loss)}</span>
              </div>
            </div>
          </div>

          {/* Scope Items by Room */}
          {Object.entries(groupedByRoom).map(([room, roomItems]) => (
            <div key={room} className="mb-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-8 w-1 bg-[#1a1a1a]"></div>
                <h4 className="font-bold text-lg text-[#1a1a1a]">{room}</h4>
              </div>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b-2 border-[#1a1a1a]">
                    <th className="text-left py-2 font-semibold text-[#1a1a1a]">Description</th>
                    <th className="text-center py-2 font-semibold text-[#1a1a1a] w-16">QTY</th>
                    <th className="text-center py-2 font-semibold text-[#1a1a1a] w-16">Unit</th>
                    <th className="text-right py-2 font-semibold text-[#1a1a1a] w-24">Labour</th>
                    <th className="text-right py-2 font-semibold text-[#1a1a1a] w-24">Materials</th>
                    <th className="text-right py-2 font-semibold text-[#1a1a1a] w-24">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {roomItems.map((item) => (
                    <tr key={item.id} className="border-b border-[#ddd]">
                      <td className="py-2 text-[#1a1a1a]">{item.item_description || '-'}</td>
                      <td className="py-2 text-center text-[#1a1a1a]">{item.qty || '-'}</td>
                      <td className="py-2 text-center text-[#1a1a1a]">{item.unit || '-'}</td>
                      <td className="py-2 text-right text-[#1a1a1a]">{fmt(item.rate_labour)}</td>
                      <td className="py-2 text-right text-[#1a1a1a]">{fmt(item.rate_materials)}</td>
                      <td className="py-2 text-right font-mono font-semibold text-[#1a1a1a]">{fmt(item.line_total)}</td>
                    </tr>
                  ))}
                  <tr className="border-b-2 border-[#1a1a1a] bg-[#f5f0e8] print:bg-gray-50">
                    <td colSpan={5} className="py-2 text-right font-bold text-[#1a1a1a]">{room} Subtotal</td>
                    <td className="py-2 text-right font-mono font-bold text-[#1a1a1a]">{fmt(roomSubtotals[room])}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {/* Special Item Types */}
        {provisionalSumItems.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-8 w-1 bg-[#1a1a1a]"></div>
              <h4 className="font-bold text-lg text-[#1a1a1a]">Provisional Sum Items</h4>
            </div>
            <table className="w-full text-sm border-collapse">
              <tbody>
                {provisionalSumItems.map((item) => (
                  <tr key={item.id} className="border-b border-[#ddd]">
                    <td className="py-2 text-[#1a1a1a]">{item.item_description || '-'}</td>
                    <td className="py-2 text-right font-mono text-[#1a1a1a]">{fmt(item.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {primeCostItems.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-8 w-1 bg-[#1a1a1a]"></div>
              <h4 className="font-bold text-lg text-[#1a1a1a]">Prime Cost Items</h4>
            </div>
            <table className="w-full text-sm border-collapse">
              <tbody>
                {primeCostItems.map((item) => (
                  <tr key={item.id} className="border-b border-[#ddd]">
                    <td className="py-2 text-[#1a1a1a]">{item.item_description || '-'}</td>
                    <td className="py-2 text-right font-mono text-[#1a1a1a]">{fmt(item.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {cashSettlementItems.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-8 w-1 bg-[#1a1a1a]"></div>
              <h4 className="font-bold text-lg text-[#1a1a1a]">Cash Settlement Items</h4>
            </div>
            <table className="w-full text-sm border-collapse">
              <tbody>
                {cashSettlementItems.map((item) => (
                  <tr key={item.id} className="border-b border-[#ddd]">
                    <td className="py-2 text-[#1a1a1a]">{item.item_description || '-'}</td>
                    <td className="py-2 text-right font-mono text-[#1a1a1a]">{fmt(item.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Quote Notes */}
        {quote.notes && (
          <div className="mb-6 p-4 bg-[#f5f0e8] print:bg-gray-50">
            <h3 className="text-lg font-bold text-[#1a1a1a] mb-2">Notes</h3>
            <p className="text-sm text-[#1a1a1a] whitespace-pre-wrap">{quote.notes}</p>
          </div>
        )}

        {/* Totals Block */}
        <div className="mb-8 p-6 bg-[#f5f0e8] print:bg-gray-50">
          <div className="flex justify-end">
            <div className="w-72">
              <div className="flex justify-between mb-2">
                <span className="text-sm text-[#1a1a1a]">Subtotal</span>
                <span className="font-mono text-sm text-[#1a1a1a]">{fmt(subtotal)}</span>
              </div>
              <div className="flex justify-between mb-2">
                <span className="text-sm text-[#1a1a1a]">Builder's Margin ({(quote.markup_pct * 100).toFixed(0)}%)</span>
                <span className="font-mono text-sm text-[#1a1a1a]">{fmt(markup)}</span>
              </div>
              <div className="flex justify-between mb-2">
                <span className="text-sm text-[#1a1a1a]">GST ({(quote.gst_pct * 100).toFixed(0)}%)</span>
                <span className="font-mono text-sm text-[#1a1a1a]">{fmt(gst)}</span>
              </div>
              <div className="flex justify-between pt-3 border-t-2 border-[#1a1a1a]">
                <span className="text-lg font-bold text-[#1a1a1a]">Total inc GST</span>
                <span className="font-mono text-2xl font-bold text-[#1a1a1a]">{fmt(total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Terms and Conditions */}
        <div className="mb-6 text-xs text-[#666]">
          <p className="mb-1">• This quote is valid for 30 days from date of issue.</p>
          <p className="mb-1">• All works are subject to site inspection and confirmation.</p>
          <p>• Prices include GST where applicable.</p>
        </div>
      </div>

      {/* Black Footer */}
      <div className="bg-[#1a1a1a] text-white p-6">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src="/logo.png" alt="IRC Logo" className="h-12 w-auto brightness-0 invert" />
            <div>
              <p className="font-bold text-lg">IRC Master</p>
              <p className="text-sm text-gray-300">Insurance Repair Management</p>
            </div>
          </div>
          <div className="text-right text-sm">
            <p className="mb-1">PHONE: {tenant.contact_phone || '1800-009-0061'}</p>
            <p className="mb-1">EMAIL: {tenant.contact_email || 'info@ircmaster.com.au'}</p>
            <p>{tenant.address || 'Australia'}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
