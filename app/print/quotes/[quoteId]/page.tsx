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

  return (
    <div className="min-h-screen bg-[#f5f0e8] print:bg-white">
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

        <p>Job details rendering works. Now adding scope items...</p>
      </div>
    </div>
  )
}
