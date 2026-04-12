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
        {/* Header - Beige banner with black logo */}
        <div className="bg-[#f5f0e8] p-6">
          <div className="flex justify-between items-center">
            {/* Logo on left */}
            <img src="/logo.png" alt="IRC Logo" className="h-16 w-auto" />
            
            {/* Job details in center and right */}
            <div className="flex-1 flex justify-end gap-8 text-sm">
              <div className="text-center">
                <p className="font-bold text-[#1a1a1a]">Quote Reference</p>
                <p className="text-[#1a1a1a]">{quote.quote_ref || '-'}</p>
              </div>
              <div className="text-center">
                <p className="font-bold text-[#1a1a1a]">Date</p>
                <p className="text-[#1a1a1a]">{formatDate(quote.created_at)}</p>
              </div>
              <div className="text-center">
                <p className="font-bold text-[#1a1a1a]">Job Number</p>
                <p className="text-[#1a1a1a]">{job.job_number}</p>
              </div>
              <div className="text-center">
                <p className="font-bold text-[#1a1a1a]">Claim Number</p>
                <p className="text-[#1a1a1a]">{job.claim_number || '-'}</p>
              </div>
              <div className="text-center">
                <p className="font-bold text-[#1a1a1a]">Insurer</p>
                <p className="text-[#1a1a1a]">{job.insurer || '-'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Title */}
        <div className="py-2 bg-white">
          <h2 className="text-lg font-bold text-[#1a1a1a] text-center">Estimate - Scope of Works</h2>
        </div>

        {/* Insured Section */}
        <div className="p-6 bg-[#f5f0e8] mb-4">
          <h3 className="font-bold text-[#1a1a1a] mb-2">Insured</h3>
          <p className="text-[#1a1a1a]">{job.insured_name || '-'}</p>
          <p className="text-[#1a1a1a]">{job.property_address || '-'}</p>
        </div>

        {/* Scope Items by Room */}
        <div className="px-6 pb-6">
          {Object.entries(groupedByRoom).map(([room, roomItems]) => (
            <div key={room} className="mb-6">
              <div className="bg-[#f5f0e8] p-4">
                <h4 className="font-bold text-[#1a1a1a] mb-3">{room}</h4>
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-[#1a1a1a]">
                      <th className="text-left py-2 font-bold text-[#1a1a1a]">DESCRIPTION</th>
                      <th className="text-center py-2 font-bold text-[#1a1a1a] w-16">QTY</th>
                      <th className="text-center py-2 font-bold text-[#1a1a1a] w-16">UNIT</th>
                      <th className="text-right py-2 font-bold text-[#1a1a1a] w-32">LABOUR, MATERIALS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roomItems.map((item) => (
                      <tr key={item.id} className="border-b border-[#ccc]">
                        <td className="py-2 text-[#1a1a1a]">{item.item_description || '-'}</td>
                        <td className="py-2 text-center text-[#1a1a1a]">{item.qty || '-'}</td>
                        <td className="py-2 text-center text-[#1a1a1a]">{item.unit || '-'}</td>
                        <td className="py-2 text-right text-[#1a1a1a]">{fmt(item.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>

        {/* Totals Section */}
        <div className="px-6 pb-6">
          <div className="bg-[#f5f0e8] p-4">
            <div className="flex justify-end">
              <div className="w-64">
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-[#1a1a1a]">SUBTOTAL</span>
                  <span className="font-mono text-sm text-[#1a1a1a]">{fmt(subtotal)}</span>
                </div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-[#1a1a1a]">GST</span>
                  <span className="font-mono text-sm text-[#1a1a1a]">{fmt(gst)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-[#1a1a1a]">
                  <span className="text-base font-bold text-[#1a1a1a]">TOTAL</span>
                  <span className="font-mono text-lg font-bold text-[#1a1a1a]">{fmt(total)}</span>
                </div>
              </div>
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
              <p className="font-bold text-lg">{quote.quote_ref || 'IRC'}</p>
              <p className="text-sm text-gray-300">{tenant.name}</p>
            </div>
          </div>
          <div className="text-right text-sm">
            <p className="mb-1">PHONE: {tenant.contact_phone || '1800-009-0061'}</p>
            <p>EMAIL: {tenant.contact_email || 'info@ircmaster.com.au'}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
