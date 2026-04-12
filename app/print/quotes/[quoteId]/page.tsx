import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'

type Quote = Database['public']['Tables']['quotes']['Row']
type ScopeItem = Database['public']['Tables']['scope_items']['Row']
type Job = Database['public']['Tables']['jobs']['Row']
type Tenant = Database['public']['Tables']['tenants']['Row']

export default async function QuotePrintPage({
  params,
}: {
  params: Promise<{ quoteId: string }>
}) {
  try {
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
      console.error('User data error:', userError)
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
      console.error('Quote error:', quoteError)
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
      console.error('Scope items error:', itemsError)
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
      console.error('Job error:', jobError)
      return <div>Job not found</div>
    }

    // Fetch tenant details for header
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .single()

    if (tenantError || !tenant) {
      console.error('Tenant error:', tenantError)
      return <div>Tenant not found</div>
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

  const formatDate = (date: string | null) => {
    if (!date) return ''
    return new Date(date).toLocaleDateString('en-AU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    })
  }

  const isDraft = quote.status === 'draft'

  return (
    <div className="min-h-screen bg-[#f5f0e8] print:bg-white">
      {/* Floating print button - hidden on print */}
      <button
        onClick={() => window.print()}
        className="fixed top-4 right-4 z-50 bg-[#1a1a1a] text-[#f5f0e8] px-4 py-2 rounded-lg font-medium hover:bg-[#333] transition-colors print:hidden"
      >
        Print / Save as PDF
      </button>

      {/* DRAFT watermark */}
      {isDraft && (
        <div className="fixed inset-0 pointer-events-none flex items-center justify-center print:hidden z-40">
          <div className="text-[#d0d0d0] text-9xl font-bold opacity-20 rotate-[-45deg] whitespace-nowrap">
            DRAFT
          </div>
        </div>
      )}

      {/* Document container */}
      <div className="max-w-4xl mx-auto p-8 bg-white shadow-lg min-h-screen print:shadow-none print:min-h-0 print:p-0">
        {/* Header */}
        <div className="border-b-2 border-[#1a1a1a] pb-6 mb-8">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-[#1a1a1a] mb-2">{tenant.name}</h1>
              {tenant.address && <p className="text-sm text-[#666]">{tenant.address}</p>}
              {tenant.contact_email && <p className="text-sm text-[#666]">{tenant.contact_email}</p>}
              {tenant.contact_phone && <p className="text-sm text-[#666]">{tenant.contact_phone}</p>}
            </div>
            <div className="text-right">
              <h2 className="text-2xl font-bold text-[#1a1a1a]">QUOTE</h2>
              {quote.quote_ref && <p className="text-lg text-[#666]">{quote.quote_ref}</p>}
              <p className="text-sm text-[#666] mt-2">Date: {formatDate(quote.created_at)}</p>
            </div>
          </div>
        </div>

        {/* Job Details */}
        <div className="mb-8 p-4 bg-[#f5f0e8] print:bg-gray-50 rounded">
          <h3 className="text-lg font-bold text-[#1a1a1a] mb-4 border-b border-[#1a1a1a] pb-2">Job Details</h3>
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
            <div>
              <span className="font-semibold text-[#666]">Job Number:</span>
              <span className="ml-2 text-[#1a1a1a]">{job.job_number}</span>
            </div>
          </div>
        </div>

        {/* Scope Items by Room */}
        <div className="mb-8">
          <h3 className="text-lg font-bold text-[#1a1a1a] mb-4 border-b border-[#1a1a1a] pb-2">Scope of Works</h3>
          
          {Object.entries(groupedByRoom).map(([room, roomItems]) => (
            <div key={room} className="mb-6">
              <div className="flex justify-between items-center mb-2">
                <h4 className="font-semibold text-[#1a1a1a]">{room}</h4>
                <span className="font-mono text-sm text-[#1a1a1a]">{fmt(roomSubtotals[room])}</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#ccc]">
                    <th className="text-left py-2 font-semibold text-[#1a1a1a]">Description</th>
                    <th className="text-center py-2 font-semibold text-[#1a1a1a] w-16">QTY</th>
                    <th className="text-center py-2 font-semibold text-[#1a1a1a] w-16">Unit</th>
                    <th className="text-right py-2 font-semibold text-[#1a1a1a] w-24">Labour/Unit</th>
                    <th className="text-right py-2 font-semibold text-[#1a1a1a] w-24">Materials/Unit</th>
                    <th className="text-right py-2 font-semibold text-[#1a1a1a] w-24">Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {roomItems.map((item) => (
                    <tr key={item.id} className="border-b border-[#eee]">
                      <td className="py-2 text-[#1a1a1a]">{item.item_description || '-'}</td>
                      <td className="py-2 text-center text-[#1a1a1a]">{item.qty || '-'}</td>
                      <td className="py-2 text-center text-[#1a1a1a]">{item.unit || '-'}</td>
                      <td className="py-2 text-right text-[#1a1a1a]">{fmt(item.rate_labour)}</td>
                      <td className="py-2 text-right text-[#1a1a1a]">{fmt(item.rate_materials)}</td>
                      <td className="py-2 text-right font-mono text-[#1a1a1a]">{fmt(item.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {/* Special Item Types */}
        {provisionalSumItems.length > 0 && (
          <div className="mb-6 p-4 bg-[#fff8e1] print:bg-gray-50 rounded border border-[#ffd54f]">
            <h4 className="font-bold text-[#1a1a1a] mb-2">Provisional Sum Items</h4>
            <table className="w-full text-sm">
              <tbody>
                {provisionalSumItems.map((item) => (
                  <tr key={item.id} className="border-b border-[#eee]">
                    <td className="py-2 text-[#1a1a1a]">{item.item_description || '-'}</td>
                    <td className="py-2 text-right font-mono text-[#1a1a1a]">{fmt(item.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {primeCostItems.length > 0 && (
          <div className="mb-6 p-4 bg-[#e8f5e9] print:bg-gray-50 rounded border border-[#81c784]">
            <h4 className="font-bold text-[#1a1a1a] mb-2">Prime Cost Items</h4>
            <table className="w-full text-sm">
              <tbody>
                {primeCostItems.map((item) => (
                  <tr key={item.id} className="border-b border-[#eee]">
                    <td className="py-2 text-[#1a1a1a]">{item.item_description || '-'}</td>
                    <td className="py-2 text-right font-mono text-[#1a1a1a]">{fmt(item.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {cashSettlementItems.length > 0 && (
          <div className="mb-6 p-4 bg-[#ffebee] print:bg-gray-50 rounded border border-[#e57373]">
            <h4 className="font-bold text-[#1a1a1a] mb-2">Cash Settlement Items</h4>
            <table className="w-full text-sm">
              <tbody>
                {cashSettlementItems.map((item) => (
                  <tr key={item.id} className="border-b border-[#eee]">
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
          <div className="mb-8 p-4 bg-[#f5f0e8] print:bg-gray-50 rounded">
            <h3 className="text-lg font-bold text-[#1a1a1a] mb-2 border-b border-[#1a1a1a] pb-2">Notes</h3>
            <p className="text-sm text-[#1a1a1a] whitespace-pre-wrap">{quote.notes}</p>
          </div>
        )}

        {/* Totals Block */}
        <div className="mt-8 pt-6 border-t-2 border-[#1a1a1a]">
          <div className="flex justify-end">
            <div className="w-64">
              <div className="flex justify-between mb-2">
                <span className="text-sm text-[#666]">Subtotal</span>
                <span className="font-mono text-sm text-[#1a1a1a]">{fmt(subtotal)}</span>
              </div>
              <div className="flex justify-between mb-2">
                <span className="text-sm text-[#666]">Builder's Margin ({(quote.markup_pct * 100).toFixed(0)}%)</span>
                <span className="font-mono text-sm text-[#1a1a1a]">{fmt(markup)}</span>
              </div>
              <div className="flex justify-between mb-2">
                <span className="text-sm text-[#666]">GST ({(quote.gst_pct * 100).toFixed(0)}%)</span>
                <span className="font-mono text-sm text-[#1a1a1a]">{fmt(gst)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-[#1a1a1a]">
                <span className="text-base font-bold text-[#1a1a1a]">Total inc GST</span>
                <span className="font-mono text-xl font-bold text-[#1a1a1a]">{fmt(total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-[#ccc] text-center text-xs text-[#666]">
          <p>This quote is prepared by {tenant.name}</p>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
          @media print {
            body {
              background: white !important;
            }
            @page {
              margin: 1cm;
            }
          }
        `
      }} />
    </div>
  )
  } catch (error) {
    console.error('Quote print page error:', error)
    return <div>Error loading quote. Please try again.</div>
  }
}
